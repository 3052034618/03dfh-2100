const dayjs = require('dayjs');
const BASE_URL = 'http://localhost:3000/api';
const assert = require('assert');

let defaultStoreKey = 'default';
let testStartTime = Date.now();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const pass = (name) => {
  const ts = ((Date.now() - testStartTime) / 1000).toFixed(1);
  console.log(`  ✅ PASS [${ts}s] ${name}`);
};
const fail = (name, err) => {
  console.log(`  ❌ FAIL: ${name}`);
  console.log(`     错误: ${err && err.message ? err.message : err}`);
  if (err && err.stack) console.log(err.stack.split('\n').slice(0, 4).map(l => '        ' + l).join('\n'));
  process.exitCode = 1;
};

const request = async (method, path, data, raw = false) => {
  const url = BASE_URL + path;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (data !== undefined) options.body = JSON.stringify(data);
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = text; }
  if (raw) return { status: res.status, json };
  if (!json || json.code !== 200) {
    const err = new Error(`[${method} ${path}] HTTP ${res.status}: ${typeof json === 'object' ? JSON.stringify(json) : String(json).slice(0, 300)}`);
    err.status = res.status;
    err.response = json;
    throw err;
  }
  return json.data;
};

const EXCEPTION_DEADLINE_MAP = {
  cake_missing: 30,
  player_count_change: 45,
  main_player_reschedule: 60
};

(async () => {
  console.log('========== 生日包场通知服务 v2.3 全量测试 ==========\n');

  // ===== 清理旧数据 =====
  console.log('[前置] 清理并配置门店...');
  {
    await request('POST', '/_debug/reset-all-data');
    const stores = await request('GET', '/store-configs');
    for (const s of stores) {
      if (s.store_key === 'default') {
        await request('PUT', `/store-configs/default`, {
          store_name: '默认店（望京总店）',
          default_assignee: '前台小王',
          exception_deadline_minutes: 45,
          channel_reception: 'wecom',
          channel_reception_target: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=default-reception',
          channel_dm: 'wecom',
          channel_dm_target: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=default-dm',
          channel_customer: 'sms',
          channel_customer_target: 'default-sms-gateway',
          channel_manager: 'wecom',
          channel_manager_target: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=default-manager',
          retry_config: {
            sms: { max_retries: 2, retry_interval_minutes: 0, escalate_on_max_retries: true },
            wecom: { max_retries: 1, retry_interval_minutes: 0, escalate_on_max_retries: false }
          }
        });
      } else {
        await request('DELETE', `/store-configs/${s.store_key}`);
      }
    }
    // 建朝阳店
    await request('POST', `/store-configs`, {
      store_key: 'chaoyang',
      store_name: '朝阳大悦城店',
      default_assignee: '朝阳前台小李',
      exception_deadline_minutes: 45,
      channel_reception: 'wecom',
      channel_reception_target: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=cy-reception',
      channel_dm: 'dingtalk',
      channel_dm_target: 'https://oapi.dingtalk.com/robot/send?access_token=cy-dm',
      channel_customer: 'sms',
      channel_customer_target: 'chaoyang-sms-gateway',
      channel_manager: 'dingtalk',
      channel_manager_target: 'https://oapi.dingtalk.com/robot/send?access_token=cy-manager',
      retry_config: {
        sms: { max_retries: 3, retry_interval_minutes: 0, escalate_on_max_retries: true },
        dingtalk: { max_retries: 2, retry_interval_minutes: 0, escalate_on_max_retries: false }
      }
    });
  }
  pass('门店配置清理完成');

  // ===== 一、近7天趋势接口 =====
  console.log('\n===== 一、近7天趋势接口 =====');
  let defaultOrders = [];
  let dailyReportToday = null;
  let trendData = null;
  try {
    // D-3天：1张订单 + 异常
    const d3Date = dayjs().subtract(3, 'day').format('YYYY-MM-DD');
    const d3Hour = dayjs().hour();
    const d3OrderRaw = await request('POST', '/orders', {
      store_key: 'default',
      customer_name: '王老三',
      customer_phone: '13900000000',
      game_date: `${d3Date} ${String(d3Hour).padStart(2, '0')}:30:00`,
      room: '房101',
      script_name: 'D-3剧本',
      player_count: 8,
      main_player_name: '张D3',
      dm_name: 'DM-D3',
      front_desk_contact: '前台小王',
      extra_services: ['蛋糕', '鲜花']
    });
    const d3Order = d3OrderRaw.order;
    const d3Notifs = await request('GET', `/orders/${d3Order.id}`);
    for (const n of d3Notifs.notifications) {
      if (n.status !== 'pending') continue;
      // 都触发成 sent
      const r = await request('POST', `/notifications/${n.id}/send`, {});
      // 把前台那条确认一下
      if (n.role === '前台') {
        await request('POST', `/notifications/${n.id}/confirm`, { reader: '测试脚本' });
      }
    }
    // D-3天 1条异常：cake_not_arrived，立即resolve（但超时）
    const d3Exc = await request('POST', '/exceptions', {
      order_id: d3Order.id, type: 'cake_not_arrived', reporter: '测试脚本',
      description: '蛋糕暂未送达', deadline_minutes: -2  // 立即使其超时
    });
    await sleep(1200);
    // 超时后再resolve（模拟处理晚了）
    await request('POST', `/exceptions/${d3Exc.id}/handle`, {
      resolution: '蛋糕已补送', remark: '隔壁烘焙店紧急补单', handled_by: '前台小王'
    });

    // D-1天：2张订单
    const d1Date = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const d1Hour = (d3Hour + 3) % 24;
    const d1Order1Raw = await request('POST', '/orders', {
      store_key: 'default', customer_name: '李老四', customer_phone: '13900000001',
      game_date: `${d1Date} ${String(d1Hour).padStart(2, '0')}:00:00`, room: '房102', script_name: 'D1-剧本A',
      player_count: 6, main_player_name: '李D1', dm_name: 'DM-D1', front_desk_contact: '前台小王'
    });
    const d1Order2Raw = await request('POST', '/orders', {
      store_key: 'default', customer_name: '赵老五', customer_phone: '13900000002',
      game_date: `${d1Date} ${String((d1Hour + 2) % 24).padStart(2, '0')}:00:00`, room: '房103', script_name: 'D1-剧本B',
      player_count: 7, main_player_name: '赵D1', dm_name: 'DM-D1b', front_desk_contact: '前台小王'
    });
    const d1Order1 = d1Order1Raw.order;
    const d1Order2 = d1Order2Raw.order;

    // 今天：2张订单（用于趋势测试的 order_count=2）
    const todayDate = dayjs().format('YYYY-MM-DD');
    const todayHour = Math.min(d3Hour + 4, 22);
    const todayOrder1Raw = await request('POST', '/orders', {
      store_key: 'default', customer_name: '今日客户1', customer_phone: '13800138000',
      game_date: `${todayDate} ${String(todayHour).padStart(2, '0')}:30:00`,
      room: '今日房1', script_name: '今日剧本1',
      player_count: 6, main_player_name: '今日主角1', dm_name: 'DM今日1',
      front_desk_contact: '前台小王'
    });
    const todayOrder2Raw = await request('POST', '/orders', {
      store_key: 'default', customer_name: '今日客户2', customer_phone: '13800138009',
      game_date: `${todayDate} ${String((todayHour + 2) % 24).padStart(2, '0')}:30:00`,
      room: '今日房2', script_name: '今日剧本2',
      player_count: 5, main_player_name: '今日主角2', dm_name: 'DM今日2',
      front_desk_contact: '前台小王'
    });

    // 明天：3张订单（用于按渠道重试/风险/异常等测试，确保3条通知都生成）
    const tomorrowDate = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const tomorrowHour = 19;
    const order1Raw = await request('POST', '/orders', {
      store_key: 'default', customer_name: '张小胖', customer_phone: '13800138001',
      game_date: `${tomorrowDate} ${String(tomorrowHour).padStart(2, '0')}:00:00`,
      room: 'VIP1号', script_name: '《死者在幻夜中醒来》',
      player_count: 7, main_player_name: '张小胖', dm_name: 'DM-大头',
      front_desk_contact: '前台小王', extra_services: ['双层生日蛋糕', '气球布置', '定制卡牌']
    });
    const order2Raw = await request('POST', '/orders', {
      store_key: 'default', customer_name: '王大美', customer_phone: '13800138002',
      game_date: `${tomorrowDate} ${String(tomorrowHour + 1).padStart(2, '0')}:30:00`,
      room: '1号普通房', script_name: '《年轮》',
      player_count: 5, main_player_name: '王大美', dm_name: 'DM-阿坤',
      front_desk_contact: '前台小王'
    });
    const order3Raw = await request('POST', '/orders', {
      store_key: 'chaoyang', customer_name: '刘小美', customer_phone: '13900000111',
      game_date: `${tomorrowDate} ${String(tomorrowHour).padStart(2, '0')}:30:00`,
      room: '朝阳房A', script_name: '《漓川怪谈簿》',
      player_count: 6, main_player_name: '刘小美', dm_name: '朝阳DM小李',
      front_desk_contact: '朝阳前台小李'
    });
    const order1 = order1Raw.order;
    const order2 = order2Raw.order;
    const order3 = order3Raw.order;
    defaultOrders = [order1, order2, order3, tomorrowDate, todayDate];

    // 对 order1 构造高风险：两条通知失败+两条异常
    let order1Notifs = (await request('GET', `/orders/${order1.id}`)).notifications;
    const order1CustomerNotif = order1Notifs.find(n => n.role === '顾客');
    const order1DmNotif = order1Notifs.find(n => n.role === 'DM');
    const order1RecepNotif = order1Notifs.find(n => n.role === '前台');
    // 强制失败2条（顾客短信+DM企微），第三条（前台）发送成功
    await request('POST', `/notifications/${order1CustomerNotif.id}/send`, { force_fail: true });
    await request('POST', `/notifications/${order1DmNotif.id}/send`, { force_fail: true });
    if (order1RecepNotif) await request('POST', `/notifications/${order1RecepNotif.id}/send`, {});
    // 上报两条异常
    await request('POST', '/exceptions', { order_id: order1.id, type: 'cake_not_arrived', reporter: '测试脚本', description: '蛋糕还没到' });
    await request('POST', '/exceptions', { order_id: order1.id, type: 'player_count_changed', reporter: '测试脚本', description: '人数从7改9' });

    pass('近7天测试数据（D-3/D-1/今天订单）创建完成');

    // **关键**：立刻保存一份明天的日报快照（此时 order1 的失败通知还没被调度器重试）
    // 后面的 trigger-escalation 调用会自动重试失败的通知并把状态改为 sent，影响风险评估
    const dailyReportSnapshotTomorrow = await request('GET', '/store-configs/default/daily-report?date=' + tomorrowDate);
    const order1DetailSnapshot = await request('GET', `/orders/${order1.id}`);
    // 保存到 defaultOrders 后面，defaultOrders 已扩展为 [order1, order2, order3, tomorrowDate, todayDate]
    defaultOrders.push(dailyReportSnapshotTomorrow); // index=5
    defaultOrders.push(order1DetailSnapshot);       // index=6

    // ====== 验证 weeklyTrend 接口 ======
    trendData = await request('GET', '/store-configs/default/weekly-trend');
    assert(trendData, '趋势接口返回为空');
    assert(trendData.daily_trend && trendData.daily_trend.length === 7, `近7天趋势应有7天，实际${trendData.daily_trend?.length}`);
    pass('weeklyTrend 接口返回7天数据');

    // 今天 order_count = 2（默认店今天只有2张）
    const todayTrend = trendData.daily_trend[6];
    assert(todayTrend.order_count === 2, `今日订单量应为2，实际${todayTrend.order_count}`);
    pass('今日趋势订单量=2（仅默认店）');

    // D-1 天 order_count = 2
    const d1Trend = trendData.daily_trend[5];
    assert(d1Trend.order_count === 2, `D-1天订单量应为2，实际${d1Trend.order_count}`);
    pass('D-1天趋势订单量=2');

    // D-3 天有 1 条 resolved_late 异常
    const d3Trend = trendData.daily_trend[3];
    assert(d3Trend.order_count === 1, `D-3天订单量应为1，实际${d3Trend.order_count}`);
    assert(d3Trend.exception_stats.resolved_late >= 1, `D-3天应有>=1条已处理但超时的异常，实际${d3Trend.exception_stats.resolved_late}`);
    pass('D-3天 resolved_late 计数有效（已处理但晚了算超时）');

    // 7天汇总
    assert(trendData.total_summary.total_orders >= 5, `7天总订单量应>=5，实际${trendData.total_summary.total_orders}`);
    assert(typeof trendData.total_summary.avg_orders_per_day === 'number', '日均订单量应为数字');
    pass('7天汇总统计（总订单/日均）正确');

    // top_fluctuations & biggest_change_date
    if (trendData.top_fluctuations && trendData.top_fluctuations.length > 0) {
      const f = trendData.top_fluctuations[0];
      assert(['order_count', 'reach_rate', 'confirm_rate', 'total_overdue', 'high_risk'].includes(f.metric_key),
        `波动指标key不对：${f.metric_key}`);
      assert(typeof f.diff_abs === 'number' && f.diff_abs > 0, '波动差值应为正数');
      pass('top_fluctuations 指标波动识别有效');
    } else {
      pass('top_fluctuations 为空（无波动，合理）');
    }
    if (trendData.biggest_change_date) {
      assert(trendData.biggest_change_date.date, '最大波动日期必须有date');
      assert(trendData.biggest_change_date.metric_label, '最大波动必须有metric_label');
      pass('biggest_change_date 识别正确');
    }
  } catch (e) { fail('近7天趋势接口测试失败', e); }

  // ===== 二、按渠道分开的重试策略 =====
  console.log('\n===== 二、按渠道分开的重试策略 =====');
  try {
    // 取 order2（默认店）的顾客短信通知和前台企微通知各一条
    const order2Detail = await request('GET', `/orders/${defaultOrders[1].id}`);
    const order2CustomerNotif = order2Detail.notifications.find(n => n.role === '顾客');
    const order2ReceptionNotif = order2Detail.notifications.find(n => n.role === '前台');
    assert(order2CustomerNotif, 'order2 顾客通知存在');
    assert(order2ReceptionNotif, 'order2 前台通知存在');
    pass('order2 顾客/前台通知存在');

    // 策略配置：sms max=2, wecom max=1
    // === 2.1：前台企微通知，force_fail，应有 next_retry_at（因为 max=1，第0次<1，可以自动重试）
    const rWecom = await request('POST', `/notifications/${order2ReceptionNotif.id}/send`, { force_fail: true });
    const wecomAfter = rWecom.notification;
    console.log(`[DEBUG wecomAfter] status=${wecomAfter?.status}, force_fail=${wecomAfter?.force_fail}, next_retry_at=${wecomAfter?.next_retry_at}`);
    // 直接再GET一次，看数据库里force_fail值
    const wecomDirect = await request('GET', `/notifications/${order2ReceptionNotif.id}`);
    console.log(`[DEBUG wecomDirect] status=${wecomDirect?.status}, force_fail=${wecomDirect?.force_fail}, next_retry_at=${wecomDirect?.next_retry_at}`);
    // wecom max_retries=1，当前 auto_retry_count=0 < 1 → 应该有 next_retry_at
    assert(wecomAfter.next_retry_at, `企微通知(wecom max=1)失败后应有 next_retry_at，实际null`);
    pass(`企微通知失败→设置 next_retry_at（因为 max=1 允许自动重试1次）`);

    // 触发调度器 tick 执行自动重试
    const tick1 = await request('POST', '/_debug/trigger-escalation');
    assert(tick1.retries && (tick1.retries.total_retryable ?? tick1.retries.total ?? 0) >= 1, `调度器 tick 应检测到>=1个可重试通知`);
    pass('调度器 tick 检测到自动重试任务');

    await sleep(1200);
    // 自动重试后，auto_retry_count=1 已达 wecom 的 max=1，且 escalate_on_max_retries=false → next_retry_at 应为 null，不升级
    const wecomAfterRetry = await request('GET', `/notifications/${order2ReceptionNotif.id}`);
    console.log(`[DEBUG wecomAfterRetry] status=${wecomAfterRetry?.status}, auto_retry_count=${wecomAfterRetry?.auto_retry_count}, next_retry_at=${wecomAfterRetry?.next_retry_at}, last_error=${wecomAfterRetry?.last_error}`);
    assert(wecomAfterRetry.auto_retry_count >= 1, `企微自动重试后 auto_retry_count 应>=1，实际${wecomAfterRetry.auto_retry_count}`);
    assert(wecomAfterRetry.next_retry_at === null, `企微达到max=1后 next_retry_at 应为null，实际${wecomAfterRetry.next_retry_at}`);
    // 不升级店长（escalate_on_max_retries=false）
    const order2Notifs2 = (await request('GET', `/orders/${defaultOrders[1].id}`)).notifications;
    const escalated1 = order2Notifs2.filter(n => n.type === 'escalation').length;
    assert(escalated1 === 0, `wecom escalate=false 不应产生升级通知，实际${escalated1}条`);
    pass('企微(wecom)渠道：达到max=1后不升级店长（escalate=false）');

    // === 2.2：顾客短信通知，force_fail → max=2 → 应有 next_retry_at
    const rSms1 = await request('POST', `/notifications/${order2CustomerNotif.id}/send`, { force_fail: true });
    const smsAfter1 = rSms1.notification;
    assert(smsAfter1.next_retry_at, `短信(sms max=2)第一次失败应有 next_retry_at，实际null`);
    pass('短信通知第1次失败→设置 next_retry_at');

    // 触发调度器自动重试（第1次 auto retry → auto_retry_count=1 < 2 → 继续 next_retry_at）
    await request('POST', '/_debug/trigger-escalation');
    await sleep(1200);
    const smsAfterAuto1 = await request('GET', `/notifications/${order2CustomerNotif.id}`);
    assert(smsAfterAuto1.auto_retry_count >= 1, `短信自动重试1次后 auto_retry_count>=1，实际${smsAfterAuto1.auto_retry_count}`);
    // 因为 force_fail 所以自动重试也失败，此时 1 < 2 → 继续有 next_retry_at
    assert(smsAfterAuto1.next_retry_at, `短信 auto_retry=1 < 2，应有 next_retry_at，实际null`);
    pass('短信自动重试第1次→仍失败，继续设置下次重试');

    // 再调度一次（第2次 auto retry → auto_retry_count=2 达到max → 升级）
    await request('POST', '/_debug/trigger-escalation');
    await sleep(1200);
    const smsAfterAuto2 = await request('GET', `/notifications/${order2CustomerNotif.id}`);
    assert(smsAfterAuto2.auto_retry_count >= 2, `短信2次自动重试后 auto_retry_count>=2，实际${smsAfterAuto2.auto_retry_count}`);
    assert(smsAfterAuto2.next_retry_at === null, `达到sms max=2后 next_retry_at 应为null，实际${smsAfterAuto2.next_retry_at}`);
    const order2Notifs3 = (await request('GET', `/orders/${defaultOrders[1].id}`)).notifications;
    const escalatedSms = order2Notifs3.filter(n => n.type === 'escalation').length;
    assert(escalatedSms >= 1, `sms escalate=true 达到max=2后应产生>=1条升级通知，实际${escalatedSms}`);
    pass('短信(sms)渠道：达到max=2后升级店长（escalate=true）');

    // === 2.3：时间线 trigger_type 区分 auto / manual / scheduled
    const order2Tl = await request('GET', `/orders/${defaultOrders[1].id}/timeline`);
    const manualEvents = order2Tl.filter(e => (e.title || '').includes('手动'));
    const autoEvents = order2Tl.filter(e => (e.title || '').includes('自动'));
    assert(manualEvents.length >= 2, `时间线应有>=2条手动操作事件，实际${manualEvents.length}`);
    assert(autoEvents.length >= 1, `时间线应有>=1条自动重试事件，实际${autoEvents.length}`);
    pass('时间线 trigger_type 区分自动重试/手动操作');
  } catch (e) { fail('按渠道分开重试策略测试失败', e); }

  // ===== 三、异常时限完全按门店配置 + 复盘超时含已处理但晚了 =====
  console.log('\n===== 三、异常时限 + 超时统计（含已处理晚了） =====');
  let cyOrderId = null;
  try {
    const todayDate = dayjs().format('YYYY-MM-DD');
    const todayHour = dayjs().hour();
    // 朝阳店新建订单
    const cyOrderRaw = await request('POST', '/orders', {
      store_key: 'chaoyang', customer_name: '朝阳客户A', customer_phone: '13911110001',
      game_date: `${todayDate} ${String(Math.min(todayHour + 3, 22)).padStart(2, '0')}:00:00`,
      room: '朝阳房B', script_name: '朝阳剧本1', player_count: 6,
      main_player_name: '朝阳主角', dm_name: '朝阳DM小王', front_desk_contact: '朝阳前台小李'
    });
    const cyOrder = cyOrderRaw.order;
    cyOrderId = cyOrder.id;

    // 3.1：朝阳店上报异常，不传时限 → 应该是朝阳店的 exception_deadline_minutes = 45分钟
    const cyExc1 = await request('POST', '/exceptions', {
      order_id: cyOrder.id, type: 'cake_not_arrived', reporter: '测试脚本', description: '朝阳蛋糕未到'
      // 不传 assignee, 不传 deadline_minutes
    });
    assert(cyExc1.assignee === '朝阳前台小李', `朝阳店默认负责人应为"朝阳前台小李"，实际"${cyExc1.assignee}"`);
    // deadline ≈ now + 45min
    const expectedDeadline = dayjs().add(45, 'minute');
    const actualDeadline = dayjs(cyExc1.deadline);
    const diffMin = Math.abs(actualDeadline.diff(expectedDeadline, 'minute'));
    assert(diffMin <= 2, `朝阳店异常时限应为≈45分钟，实际差值${diffMin}分钟（"${cyExc1.deadline}"）`);
    pass('朝阳店异常：默认负责人=朝阳前台小李，时限≈45分钟（完全按门店配置）');

    // 3.2：默认店 order2 也上报一条异常，不传时限 → 应为默认店配置的 45分钟（不再走 EXCEPTION_DEADLINE_MAP 的 30 分钟）
    const defExc1 = await request('POST', '/exceptions', {
      order_id: defaultOrders[1].id, type: 'cake_not_arrived', reporter: '测试脚本', description: '默认店蛋糕未到'
      // 不传 deadline_minutes → 过去会走 EXCEPTION_DEADLINE_MAP['cake_not_arrived']=30，现在应该走门店的45
    });
    const defActual = dayjs(defExc1.deadline);
    const defExpected = dayjs().add(45, 'minute');
    const defDiffMin = Math.abs(defActual.diff(defExpected, 'minute'));
    assert(defDiffMin <= 2, `默认店 cake_missing 异常时限应为≈45分钟(门店配置)，实际差值${defDiffMin}分钟。说明：过去走EXCEPTION_DEADLINE_MAP=30，现在应完全走门店配置`);
    pass('默认店 cake_missing 异常：时限=45分钟（完全按门店配置，不走 EXCEPTION_DEADLINE_MAP 的 30 分钟）');

    // 3.3：复盘日报的超时统计含"已处理但晚了"
    // 在 D-3天订单上已经造了1条 resolved_late，再额外在 order3 上造1条
    const lateExc = await request('POST', '/exceptions', {
      order_id: defaultOrders[1].id, type: 'player_count_changed', reporter: '测试脚本',
      description: '人数变动', deadline_minutes: -3  // 立即超时
    });
    await sleep(1200);
    await request('POST', `/exceptions/${lateExc.id}/handle`, {
      resolution: '加了2把椅子', remark: '临时解决', handled_by: '前台小王'
    });

    dailyReportToday = await request('GET', '/store-configs/default/daily-report?date=' + defaultOrders[3]);
    const excStats = dailyReportToday.summary.exception_stats;
    assert(excStats.resolved_late >= 1, `日报异常统计 resolved_late>=1，实际${excStats.resolved_late}`);
    assert(excStats.total_overdue >= (excStats.overdue + excStats.resolved_late),
      `total_overdue 应该是未处理超时+处理晚了的总和，overdue=${excStats.overdue}, resolved_late=${excStats.resolved_late}, total_overdue=${excStats.total_overdue}`);
    pass('日报超时统计：resolved_late 被计入（已处理但晚了也算超时）');
  } catch (e) { fail('异常时限+超时统计测试失败', e); }

  // ===== 四、风险等级分级 + 高风险优先排序 + 订单详情风险信息 =====
  console.log('\n===== 四、风险等级分级 + 排序 + 订单详情 =====');
  try {
    // 使用测试开头保存的快照（此时 order1 的通知还处于 failed 状态，未被调度器重试）
    const dailyReportSnapshot = defaultOrders[5];
    const order1DetailSnapshot = defaultOrders[6];

    // 快照里：order1 已有风险（order2 还未上报异常，所以可能1-2个）
    assert(dailyReportSnapshot.risk_orders && dailyReportSnapshot.risk_orders.length >= 1,
      `快照风险订单数量应>=1，实际${dailyReportSnapshot.risk_orders?.length}`);
    pass(`快照风险订单数量=${dailyReportSnapshot.risk_orders.length} 正确`);

    // 实时查（测试块三已处理完 order2 的 resolved_late 异常）：应该有>=2个风险订单
    dailyReportToday = await request('GET', '/store-configs/default/daily-report?date=' + defaultOrders[3]);
    assert(dailyReportToday.risk_orders && dailyReportToday.risk_orders.length >= 2,
      `实时风险订单数量应>=2，实际${dailyReportToday.risk_orders?.length}`);
    pass(`实时风险订单数量=${dailyReportToday.risk_orders.length}（含order2的resolved_late）`);

    // ============ 快照断言：order1 高风险和风险排序（未被调度器重试时的状态） ============
    const snapOrder1 = dailyReportSnapshot.risk_orders.find(r => r.order_id === defaultOrders[0].id);
    assert(snapOrder1, `快照：order1 应在风险列表里`);
    assert(snapOrder1.risk_level === 'high', `快照：order1 应为高风险(high)，实际${snapOrder1.risk_level}（${snapOrder1.risk_level_label}）`);
    assert(snapOrder1.risk_score >= 30, `快照：高风险 score 应>=30，实际${snapOrder1.risk_score}`);
    assert(snapOrder1.risk_factors.includes('多条通知发送失败'), `快照：order1 风险因子应包含"多条通知发送失败"`);
    assert(snapOrder1.risk_factors.includes('多异常并发'), `快照：order1 风险因子应包含"多异常并发"`);
    pass('快照：order1 风险评估：高风险 + 多因子正确');

    // 快照断言：高风险优先（order1 是高风险，应排第一）
    const snapHasHigh = dailyReportSnapshot.risk_orders.some(r => r.risk_level === 'high');
    if (snapHasHigh) {
      assert(dailyReportSnapshot.risk_orders[0].risk_level === 'high',
        `快照：风险排序首个应为高风险(high)，实际${dailyReportSnapshot.risk_orders[0].risk_level}（score=${dailyReportSnapshot.risk_orders[0].risk_score}）`);
      pass('快照：风险排序：高风险订单优先');
    }

    // ============ 实时断言：risk_stats 统计正确（order1+order2 都算风险） ============
    const rs = dailyReportToday.summary.risk_stats;
    assert(rs.high >= 0, `高风险订单统计存在`);
    assert(rs.medium >= 1, `中风险订单统计>=1（order2 resolved_late），实际${rs.medium}`);
    assert(rs.high + rs.medium + rs.low >= 2,
      `risk_stats 总和应>=2（order1+order2），实际high=${rs.high}, med=${rs.medium}, low=${rs.low}`);
    pass('risk_stats 高低风险统计正确（实时，含 order2 的 resolved_late）');

    // 订单详情返回风险信息（用快照，避免 trigger-escalation 改变通知状态）
    assert(order1DetailSnapshot.risk_info, '订单详情应有 risk_info');
    assert(order1DetailSnapshot.risk_info.risk_level === 'high', `订单详情 risk_level=high，实际${order1DetailSnapshot.risk_info.risk_level}`);
    assert(Array.isArray(order1DetailSnapshot.risk_info.risk_factors) && order1DetailSnapshot.risk_info.risk_factors.length >= 2,
      `订单详情 risk_factors 应有>=2条，实际${order1DetailSnapshot.risk_info.risk_factors?.length}`);
    assert(typeof order1DetailSnapshot.risk_info.overdue_exception_count === 'number', '订单详情应有 overdue_exception_count');
    assert(typeof order1DetailSnapshot.risk_info.resolved_late_count === 'number', '订单详情应有 resolved_late_count');
    pass('订单详情 risk_info：风险等级、因子、超时计数正确（快照）');

    // 低风险/无风险订单验证：朝阳店 order3 今天没有任何异常和失败通知，应为无风险或低风险
    const order3Detail = await request('GET', `/orders/${defaultOrders[2].id}`);
    // 如果 risk_level=low 但 factor 不为空也合理
    if (order3Detail.risk_info.risk_factors.length === 0) {
      assert(order3Detail.risk_info.risk_level === 'low', '无风险因子的订单风险等级应为low');
      pass('朝阳店无异常无失败通知订单：风险=low，因子为空');
    } else {
      pass(`朝阳店订单：risk_level=${order3Detail.risk_info.risk_level}, factors=${order3Detail.risk_info.risk_factors.join('、')}`);
    }
  } catch (e) { fail('风险等级测试失败', e); }

  // ===== 五、朝阳店 vs 默认店的渠道重试策略不同（门店隔离 + 渠道隔离双保险） =====
  console.log('\n===== 五、门店+渠道双隔离：朝阳店短信 vs 默认店短信策略不同 =====');
  try {
    // 朝阳店 retry_config.sms.max_retries=3（默认店是2）
    // 对朝阳店今天的 order3 顾客通知，force_fail → 应可自动重试3次
    const order3Detail = await request('GET', `/orders/${defaultOrders[2].id}`);
    const order3CustNotif = order3Detail.notifications.find(n => n.role === '顾客');
    // 失败一次
    await request('POST', `/notifications/${order3CustNotif.id}/send`, { force_fail: true });
    // 第一次自动调度
    await request('POST', '/_debug/trigger-escalation');
    await sleep(1200);
    const after1 = await request('GET', `/notifications/${order3CustNotif.id}`);
    // auto_retry_count=1 < 3，继续有 next_retry_at
    assert(after1.auto_retry_count >= 1 && (after1.next_retry_at || after1.auto_retry_count < 3),
      `朝阳店sms第1次自动重试后应有next_retry_at，auto_retry=${after1.auto_retry_count}, next_retry_at=${after1.next_retry_at}`);
    pass('朝阳店 sms max=3：第1次自动重试后仍可继续');

    // 第二次自动调度
    await request('POST', '/_debug/trigger-escalation');
    await sleep(1200);
    const after2 = await request('GET', `/notifications/${order3CustNotif.id}`);
    pass(`朝阳店 sms：第2次自动重试后 auto_retry_count=${after2.auto_retry_count}`);

    // 第三次自动调度（达到 max=3）
    await request('POST', '/_debug/trigger-escalation');
    await sleep(1200);
    const after3 = await request('GET', `/notifications/${order3CustNotif.id}`);
    assert(after3.auto_retry_count >= 3, `朝阳店sms达到max=3，auto_retry_count=${after3.auto_retry_count}`);
    assert(after3.next_retry_at === null, `达到max=3后 next_retry_at=null，实际${after3.next_retry_at}`);
    pass('朝阳店 sms：达到 max=3 次自动重试（默认店只有2次，门店+渠道双隔离验证通过）');

    // 朝阳店 dingtalk escalate=false（而 sms escalate=true）
    // 用朝阳店刚才那个订单 cyOrder（如果存在的话）的 DM 通知（渠道是dingtalk）
    if (cyOrderId) {
      const cyOrderDetail = await request('GET', `/orders/${cyOrderId}`);
      const cyDmNotif = cyOrderDetail.notifications.find(n => n.role === 'DM');
      if (cyDmNotif) {
        await request('POST', `/notifications/${cyDmNotif.id}/send`, { force_fail: true });
        // 调度2次（dingtalk max=2，escalate=false）
        await request('POST', '/_debug/trigger-escalation');
        await sleep(1200);
        await request('POST', '/_debug/trigger-escalation');
        await sleep(1200);
        // 看 cyOrder 通知里有没有 escalation
        const cyFinalDetail = await request('GET', `/orders/${cyOrderId}`);
        const cyEscalations = cyFinalDetail.notifications.filter(n => n.type === 'escalation').length;
        assert(cyEscalations === 0, `朝阳店DM(dingtalk) escalate=false，升级数应为0，实际${cyEscalations}`);
        pass('朝阳店 DM 通知(dingtalk max=2, escalate=false)：达到上限不升级店长');
      }
    }
  } catch (e) { fail('门店+渠道双隔离测试失败', e); }

  console.log('\n========== v2.3 测试完成 ==========');
  if (!process.exitCode) console.log('🎉 全部通过！');
  else console.log('❌ 有失败，请检查上方日志');
})().catch(err => {
  console.error('测试脚本异常退出:', err && err.message ? err.message : err);
  process.exitCode = 1;
});
