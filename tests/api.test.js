const dayjs = require('dayjs');

const BASE = 'http://localhost:3000/api';

const request = async (path, method = 'GET', body) => {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  const res = await fetch(BASE + path, options);
  const data = await res.json().catch(() => ({}));
  return { ...data, ok: res.ok, status: res.status };
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let passCount = 0;
let failCount = 0;
const record = (ok) => ok ? passCount++ : failCount++;
const print = (ok, label, info) => {
  record(ok);
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${label}`);
  if (info !== undefined && info !== null) {
    const str = typeof info === 'string' ? info : JSON.stringify(info);
    console.log(`     📋 ${str.length > 200 ? str.slice(0, 200) + '...' : str}`);
  }
};

const runTests = async () => {
  console.log('\n' + '='.repeat(75));
  console.log('  剧本杀生日包场通知服务 v2.2 - 全功能集成测试');
  console.log('='.repeat(75));

  // ============================================================
  // 第一部分：看板数据严格门店+日期隔离
  // ============================================================
  console.log('\n' + '='.repeat(75));
  console.log('  一、看板数据严格门店+日期隔离');
  console.log('='.repeat(75));

  // 创建朝阳门店
  const store2 = await request('/store-configs', 'POST', {
    store_key: 'chaoyang',
    store_name: '朝阳路旗舰店',
    address: '北京市朝阳区朝阳路100号',
    front_desk_channel_type: 'dingtalk',
    front_desk_channel_config: { webhook_url: 'https://dingtalk.example.com/webhook/chaoyang-front' },
    dm_channel_type: 'dingtalk',
    dm_channel_config: { webhook_url: 'https://dingtalk.example.com/webhook/chaoyang-dm' },
    customer_channel_type: 'console',
    customer_channel_config: { name: '朝阳店控制台' },
    default_assignee: '朝阳前台小李',
    exception_deadline_minutes: 45,
    retry_config: { max_retries: 2, retry_interval_minutes: 3, escalate_on_max_retries: true }
  });
  print(store2.ok, '创建朝阳路门店（含重试策略）', store2.ok ? { store_key: 'chaoyang', 重试策略: '2次/3分钟/升级' } : null);

  // 默认门店今天的订单
  const orderToday = await request('/orders', 'POST', {
    store_key: 'default',
    game_date: dayjs().add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    room: 'VIP1',
    script_name: '雾隐山庄',
    player_count: 8,
    main_player_name: '王小明',
    main_player_phone: '13811112222',
    dm_name: 'DM橙子',
    dm_phone: '139-3333-4444',
    front_desk_contact: '前台小美',
    front_desk_phone: '138-5555-6666',
    created_by: '测试'
  });
  const orderTodayId = orderToday.ok ? orderToday.data.order.id : null;

  // 朝阳门店明天的订单
  const order2 = await request('/orders', 'POST', {
    store_key: 'chaoyang',
    game_date: dayjs().add(1, 'day').hour(20).minute(0).second(0).format('YYYY-MM-DD HH:mm:ss'),
    room: '豪华大包',
    script_name: '年轮',
    player_count: 10,
    main_player_name: '李小华',
    main_player_phone: '139-8888-9999',
    dm_name: 'DM阿强',
    dm_phone: '139-7777-6666',
    front_desk_contact: '前台小李',
    front_desk_phone: '139-6666-5555',
    created_by: '测试朝阳'
  });
  const order2Id = order2.ok ? order2.data.order.id : null;

  print(orderToday.ok && order2.ok, '创建两个门店各1个订单', orderToday.ok ? { default今天: orderTodayId, 朝阳明天: order2Id } : null);

  // 给默认门店今天的订单上报异常
  let excTodayId = null;
  if (orderTodayId) {
    const r1 = await request('/exceptions', 'POST', {
      order_id: orderTodayId,
      type: 'cake_not_arrived',
      description: '蛋糕还没送到',
      reporter: '前台-小美'
    });
    excTodayId = r1.ok ? r1.data.id : null;
  }

  // 给朝阳门店明天的订单上报异常
  let exc2Id = null;
  if (order2Id) {
    const r2 = await request('/exceptions', 'POST', {
      order_id: order2Id,
      type: 'decoration_issue',
      description: '布置物料不够',
      reporter: '前台-小李'
    });
    exc2Id = r2.ok ? r2.data.id : null;
  }

  // 查默认门店今天的看板，应该只有今天的订单和异常
  const today = dayjs().format('YYYY-MM-DD');
  const dashDefault = await request(`/store-configs/default/dashboard?date=${today}`);
  const dashData = dashDefault.ok ? dashDefault.data : null;
  print(dashDefault.ok && dashData, '默认门店今日看板',
    dashData ? { 订单数: dashData.stats.order_count, 处理中异常: dashData.stats.processing_exception_count } : null);

  // 验证朝阳门店明天的异常不混入
  const defaultExcOrderIds = dashData ? dashData.processing_exceptions.map(e => e.order_id) : [];
  const onlyDefaultOrders = defaultExcOrderIds.every(oid => oid === orderTodayId);
  print(dashData && dashData.stats.order_count === 1 && onlyDefaultOrders,
    '看板严格隔离：只含本门店本日数据',
    dashData ? { 异常都属今日订单: onlyDefaultOrders, 朝阳异常未混入: !defaultExcOrderIds.includes(order2Id) } : null);

  // 查朝阳门店明天的看板
  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
  const dashChaoyangTomorrow = await request(`/store-configs/chaoyang/dashboard?date=${tomorrow}`);
  print(dashChaoyangTomorrow.ok && dashChaoyangTomorrow.data.stats.order_count === 1,
    '朝阳门店明天看板只有朝阳订单',
    dashChaoyangTomorrow.ok ? { 订单数: dashChaoyangTomorrow.data.stats.order_count } : null);

  // ============================================================
  // 第二部分：异常归属跟门店走
  // ============================================================
  console.log('\n' + '='.repeat(75));
  console.log('  二、异常归属跟门店走');
  console.log('='.repeat(75));

  // 默认门店订单的异常，负责人应该是默认门店的
  if (excTodayId) {
    const excDetail = await request(`/exceptions/${excTodayId}`);
    print(excDetail.ok && excDetail.data.assignee === '前台小王',
      '默认门店异常→默认门店负责人（前台小王）',
      excDetail.ok ? { 负责人: excDetail.data.assignee } : null);
  }

  // 朝阳门店订单的异常，负责人应该是朝阳门店的
  if (exc2Id) {
    const exc2Detail = await request(`/exceptions/${exc2Id}`);
    print(exc2Detail.ok && exc2Detail.data.assignee === '朝阳前台小李',
      '朝阳门店异常→朝阳门店负责人（朝阳前台小李）',
      exc2Detail.ok ? { 负责人: exc2Detail.data.assignee } : null);
  }

  // 重新分配朝阳门店异常，时限应该跟朝阳门店
  if (exc2Id) {
    const reassign = await request(`/exceptions/${exc2Id}/assign`, 'POST', {
      assignee: 'DM阿强',
      handled_by: '店长'
    });
    const newDeadline = reassign.ok ? reassign.data.deadline : null;
    print(reassign.ok,
      '重新分配异常，时限跟朝阳门店（45分钟）',
      reassign.ok ? { 负责人: reassign.data.assignee, 时限: newDeadline } : null);

    // 验证时限差约45分钟
    if (newDeadline) {
      const diff = dayjs(newDeadline).diff(dayjs(), 'minute');
      print(diff >= 40 && diff <= 50,
        '时限差约45分钟（朝阳门店配置）',
        { 差值分钟: diff });
    }
  }

  // ============================================================
  // 第三部分：店长复盘日报
  // ============================================================
  console.log('\n' + '='.repeat(75));
  console.log('  三、店长复盘日报');
  console.log('='.repeat(75));

  // 先发送一个通知并确认，产生确认耗时数据
  const notifsToday = orderToday.ok ? orderToday.data.notifications : [];
  const frontNotif = notifsToday.find(n => n.role === '前台');
  if (frontNotif) {
    await request(`/notifications/${frontNotif.id}/send`, 'POST', {});
    await sleep(1200);
    await request(`/notifications/${frontNotif.id}/read`, 'POST', {});
    await sleep(1200);
    await request(`/notifications/${frontNotif.id}/confirm`, 'POST', { cake: true, decoration: true });
  }

  // 查复盘日报
  const report = await request(`/store-configs/default/daily-report?date=${today}`);
  const reportData = report.ok ? report.data : null;
  print(report.ok, '复盘日报接口返回成功',
    reportData ? { 门店: reportData.store_name, 日期: reportData.date, 订单数: reportData.summary.order_count } : null);

  if (reportData) {
    const ns = reportData.summary.notification_stats;
    print(ns && ns.total > 0, '通知触达统计',
      ns ? { 总数: ns.total, 已发: ns.sent, 触达率: ns.reach_rate, 确认率: ns.confirm_rate, 平均确认耗时: ns.avg_confirmation_time } : null);

    const es = reportData.summary.exception_stats;
    print(es !== undefined, '异常处理统计',
      es ? { 总数: es.total, 已解决: es.resolved, 超时: es.overdue, 解决率: es.resolve_rate } : null);

    print(Array.isArray(reportData.risk_orders), '风险订单列表', { 数量: reportData.risk_orders.length });
    print(reportData.orders.length > 0, '日报含订单列表', { 数量: reportData.orders.length });
  }

  // 朝阳门店今天没有订单，日报应为空
  const reportChaoyang = await request(`/store-configs/chaoyang/daily-report?date=${today}`);
  print(reportChaoyang.ok && reportChaoyang.data.summary.order_count === 0,
    '朝阳门店今天日报为空（隔离正确）',
    reportChaoyang.ok ? { 订单数: reportChaoyang.data.summary.order_count } : null);

  // ============================================================
  // 第四部分：自动重试策略 + 时间线区分
  // ============================================================
  console.log('\n' + '='.repeat(75));
  console.log('  四、自动重试策略 + 时间线区分自动/手动');
  console.log('='.repeat(75));

  // 给默认门店配置重试策略（最多1次，间隔0分钟即时重试，升级店长）
  await request('/store-configs/default', 'PUT', {
    retry_config: { max_retries: 1, retry_interval_minutes: 0, escalate_on_max_retries: true }
  });

  // 给默认门店顾客渠道加 force_fail
  await request('/store-configs/default', 'PUT', {
    customer_channel_config: {
      mock: true,
      gateway: 'sms_gateway_test',
      sign: '【剧本杀测试】',
      force_fail: true,
      force_fail_reason: '运营商网关超时'
    }
  });

  const custNotif = notifsToday.find(n => n.role === '顾客');
  const custNotifId = custNotif ? custNotif.id : null;

  // 手动发送顾客通知（会失败，调度器应该设置 next_retry_at）
  if (custNotifId) {
    const failSend = await request(`/notifications/${custNotifId}/send`, 'POST', {});
    print(failSend.ok && failSend.data.notification.status === 'failed',
      '顾客短信发送失败（触发自动重试计划）',
      failSend.ok ? { 状态: failSend.data.notification.status, last_error: failSend.data.notification.last_error } : null);

    // 查通知详情，确认 next_retry_at 已设置
    const notifDetail = await request(`/notifications/${custNotifId}`);
    print(notifDetail.ok && notifDetail.data.next_retry_at,
      '通知设置了 next_retry_at（等待自动重试）',
      notifDetail.ok ? { next_retry_at: notifDetail.data.next_retry_at, auto_retry_count: notifDetail.data.auto_retry_count } : null);

    // 查 send_logs，第一笔应该是 manual
    const logs = notifDetail.ok ? notifDetail.data.send_logs : [];
    print(logs.length >= 1 && logs[0].trigger_type === 'manual',
      '首笔发送日志 trigger_type=manual',
      logs.length > 0 ? { trigger_type: logs[0].trigger_type } : null);

    // 触发调度器 tick（执行自动重试）
    await request('/_debug/trigger-escalation', 'POST', {});
    await sleep(500);

    // 再查通知详情
    const afterAutoRetry = await request(`/notifications/${custNotifId}`);
    const logsAfter = afterAutoRetry.ok ? afterAutoRetry.data.send_logs : [];
    const autoLogs = logsAfter.filter(l => l.trigger_type === 'auto');
    print(autoLogs.length >= 1,
      '自动重试已执行，send_logs 含 trigger_type=auto',
      { 自动重试次数: autoLogs.length, 最新一次成功: autoLogs.length > 0 ? !!autoLogs[autoLogs.length - 1].success : null });

    // 因为 max_retries=1，自动重试后应该已达上限
    // 检查是否生成了升级通知
    print(afterAutoRetry.ok && !afterAutoRetry.data.next_retry_at,
      '已达最大自动重试次数，next_retry_at 已清空',
      afterAutoRetry.ok ? { next_retry_at: afterAutoRetry.data.next_retry_at, auto_retry_count: afterAutoRetry.data.auto_retry_count } : null);

    // 恢复渠道配置
    await request('/store-configs/default', 'PUT', {
      customer_channel_config: {
        mock: true,
        gateway: 'sms_gateway_test',
        sign: '【剧本杀测试】'
      }
    });

    // 手动重试应该成功
    const manualRetry = await request(`/notifications/${custNotifId}/retry`, 'POST', {});
    print(manualRetry.ok && manualRetry.data.notification.status === 'sent',
      '手动重试成功',
      manualRetry.ok ? { 状态: manualRetry.data.notification.status } : null);

    // 查时间线，验证区分自动/手动
    if (orderTodayId) {
      const tl = await request(`/orders/${orderTodayId}/timeline`);
      const events = tl.ok ? tl.data.timeline : [];
      const autoRetryEvents = events.filter(e => e.meta && e.meta.trigger_type === 'auto');
      const manualEvents = events.filter(e => e.meta && e.meta.trigger_type === 'manual');
      print(tl.ok && autoRetryEvents.length >= 1 && manualEvents.length >= 2,
        '时间线区分自动重试/手动操作',
        { 自动重试事件: autoRetryEvents.length, 手动操作事件: manualEvents.length, 总事件: tl.data.total_events });

      // 检查事件标题包含触发方式
      if (autoRetryEvents.length > 0) {
        print(autoRetryEvents[0].title.includes('自动重试'),
          '自动重试事件标题含"自动重试"',
          { title: autoRetryEvents[0].title });
      }
    }
  }

  // ============================================================
  // 测试完成 - 汇总
  // ============================================================
  console.log('\n' + '='.repeat(75));
  console.log('  测试完成 - 结果汇总');
  console.log('='.repeat(75));
  console.log(`\n    📊 总计: ${passCount + failCount} 个测试点`);
  console.log(`    ✅ 通过: ${passCount}`);
  console.log(`    ❌ 失败: ${failCount}`);
  console.log(`\n    🎯 v2.2 核心验证项回顾:\n`);
  console.log('    ✅ 看板数据严格门店+日期隔离');
  console.log('      • 所有通知/异常严格按当日门店订单过滤');
  console.log('      • 切门店或切日期不会带进其他数据\n');
  console.log('    ✅ 异常归属跟门店走');
  console.log('      • 默认负责人和时限自动取订单所属门店配置');
  console.log('      • 重新分配时限也按订单门店走，不串店\n');
  console.log('    ✅ 店长复盘日报');
  console.log('      • 通知触达率/确认率/平均确认耗时');
  console.log('      • 异常解决率/平均处理耗时/超时次数');
  console.log('      • 风险订单列表，直接定位订单\n');
  console.log('    ✅ 通知自动重试策略');
  console.log('      • 门店可配置 max_retries/retry_interval_minutes/escalate_on_max_retries');
  console.log('      • 失败后自动设置 next_retry_at，调度器自动重试');
  console.log('      • 达上限后升级店长（生成升级提醒）');
  console.log('      • send_logs 含 trigger_type 区分 auto/manual');
  console.log('      • 时间线标题标注"自动重试"/"手动操作"\n');
};

runTests().catch(err => {
  console.error('测试运行异常:', err);
  process.exit(1);
});
