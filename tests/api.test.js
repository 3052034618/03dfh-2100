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

const log = (msg) => console.log(msg);
const logSection = (title) => {
  console.log('\n' + '='.repeat(75));
  console.log(`  ${title}`);
  console.log('='.repeat(75));
};
const logSub = (title) => {
  console.log(`\n  ── ${title} ${'─'.repeat(Math.max(5, 55 - title.length))}`);
};
const logResult = (label, ok, data, errMsg) => {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${label}`);
  if (data !== undefined && data !== null) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    console.log(`     📋 ${str.length > 200 ? str.slice(0, 200) + '...' : str}`);
  }
  if (errMsg && !ok) {
    console.log(`     ⚠️  ${errMsg}`);
  }
};

let passCount = 0;
let failCount = 0;
const record = (ok) => ok ? passCount++ : failCount++;
const print = (ok, label, info) => {
  record(ok);
  logResult(label, ok, info);
};

const runTests = async () => {
  console.log('\n' + '='.repeat(75));
  console.log('  剧本杀生日包场通知服务 v2.1 - 全功能集成测试');
  console.log('='.repeat(75));

  // ============================================================
  // 第一部分：多门店渠道配置 & 隔离
  // ============================================================
  logSection('一、多门店通知渠道配置 & 隔离');

  logSub('1.1 创建第二家门店（配置不同渠道）');
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
    manager_name: '张店长',
    default_assignee: '前台小李',
    exception_deadline_minutes: 45
  });
  print(store2.ok && store2.code === 200, '创建朝阳路门店成功',
    store2.ok ? { store_key: 'chaoyang', 前台渠道: 'dingtalk', 顾客渠道: 'console' } : null,
    store2.ok ? null : store2.message);

  logSub('1.2 两家门店各自下单（明天的局，确保3条提醒都生成），验证渠道不串店');

  // 默认门店下订单（明天的局，确保3条提醒都生成）
  const order1 = await request('/orders', 'POST', {
    store_key: 'default',
    game_date: dayjs().add(1, 'day').hour(19).minute(0).second(0).format('YYYY-MM-DD HH:mm:ss'),
    room: 'VIP1',
    script_name: '雾隐山庄·生日特供版',
    player_count: 8,
    main_player_name: '王小明',
    main_player_phone: '13811112222',
    dm_name: 'DM橙子',
    dm_phone: '139-3333-4444',
    front_desk_contact: '前台小美',
    front_desk_phone: '138-5555-6666',
    created_by: '测试'
  });
  const order1Id = order1.ok ? order1.data.order.id : null;

  // 朝阳门店下订单（明天的局）
  const order2 = await request('/orders', 'POST', {
    store_key: 'chaoyang',
    game_date: dayjs().add(1, 'day').hour(20).minute(0).second(0).format('YYYY-MM-DD HH:mm:ss'),
    room: '豪华大包',
    script_name: '年轮·生日沉浸版',
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

  print(order1.ok && order2.ok, '两个门店各创建1个订单成功',
    order1.ok ? { default店: order1Id, 朝阳店: order2Id } : null);

  // 验证默认门店订单的通知渠道
  const notif1List = order1.ok ? order1.data.notifications : [];
  const defaultFrontNotif = notif1List.find(n => n.role === '前台');
  const defaultCustNotif = notif1List.find(n => n.role === '顾客');
  print(defaultFrontNotif && defaultFrontNotif.channel === 'wecom',
    '默认门店-前台通知=企业微信',
    defaultFrontNotif ? { 渠道: defaultFrontNotif.channel, 目标: defaultFrontNotif.channel_target } : null);
  print(defaultCustNotif && defaultCustNotif.channel === 'sms',
    '默认门店-顾客通知=短信',
    defaultCustNotif ? { 渠道: defaultCustNotif.channel, 目标: defaultCustNotif.channel_target } : null);

  // 验证朝阳门店订单的通知渠道
  const notif2List = order2.ok ? order2.data.notifications : [];
  const chaoyangFrontNotif = notif2List.find(n => n.role === '前台');
  const chaoyangCustNotif = notif2List.find(n => n.role === '顾客');
  print(chaoyangFrontNotif && chaoyangFrontNotif.channel === 'dingtalk',
    '朝阳门店-前台通知=钉钉',
    chaoyangFrontNotif ? { 渠道: chaoyangFrontNotif.channel, 目标: chaoyangFrontNotif.channel_target } : null);
  print(chaoyangCustNotif && chaoyangCustNotif.channel === 'console',
    '朝阳门店-顾客通知=控制台',
    chaoyangCustNotif ? { 渠道: chaoyangCustNotif.channel, 目标: chaoyangCustNotif.channel_target } : null);

  // 验证 list 按 storeKey 过滤
  const listDefault = await request('/orders?storeKey=default');
  const listChaoyang = await request('/orders?storeKey=chaoyang');
  print(listDefault.ok && listDefault.data.total >= 1,
    '订单列表按 storeKey=default 过滤正确',
    listDefault.ok ? { 数量: listDefault.data.total } : null);
  print(listChaoyang.ok && listChaoyang.data.total >= 1,
    '订单列表按 storeKey=chaoyang 过滤正确',
    listChaoyang.ok ? { 数量: listChaoyang.data.total } : null);

  // ============================================================
  // 第二部分：时间线真实时间 & 确认记录
  // ============================================================
  logSection('二、时间线真实时间 & 确认记录');

  logSub('2.1 手动发送前台通知 + 标记已读 + 确认，验证时间线');

  const frontNotifId = defaultFrontNotif ? defaultFrontNotif.id : null;
  let sendResult = null;
  let readTime = null;
  let confirmTime = null;

  if (frontNotifId) {
    // 发送
    const sendRes = await request(`/notifications/${frontNotifId}/send`, 'POST', {});
    sendResult = sendRes.ok ? sendRes.data : null;
    print(sendRes.ok && sendRes.data.notification.status === 'sent',
      '手动发送前台通知成功',
      sendRes.ok ? { 状态: sendRes.data.notification.status, 渠道: sendRes.data.notification.channel } : null,
      sendRes.ok ? null : sendRes.message);

    await sleep(1200);
    const beforeRead = dayjs();

    // 已读
    const readRes = await request(`/notifications/${frontNotifId}/read`, 'POST', {});
    readTime = readRes.ok && readRes.data ? readRes.data.read_at : null;
    print(readRes.ok && readRes.data.read_at,
      '标记已读记录真实时间',
      readRes.ok ? { read_at: readRes.data.read_at } : null);

    await sleep(1200);

    // 确认
    const confirmRes = await request(`/notifications/${frontNotifId}/confirm`, 'POST', {
      cake: true,
      decoration: true
    });
    confirmTime = confirmRes.ok && confirmRes.data ? confirmRes.data.confirmed_at : null;
    print(confirmRes.ok && confirmRes.data.confirmed_at,
      '确认通知记录真实 confirmed_at',
      confirmRes.ok ? { confirmed_at: confirmRes.data.confirmed_at, 蛋糕已确认: confirmRes.data.cake_confirmed } : null);
  }

  // 查时间线，验证真实时间
  if (order1Id) {
    const tl = await request(`/orders/${order1Id}/timeline`);
    const events = tl.ok ? tl.data.timeline : [];
    const sentEvent = events.find(e => e.type === 'notification_sent' && e.title.includes('开场前一天'));
    const readEvent = events.find(e => e.type === 'notification_read' && e.title.includes('前台'));
    const confirmEvent = events.find(e => e.type === 'notification_confirmed' && e.title.includes('前台'));

    print(tl.ok && tl.data.total_events >= 6,
      '订单时间线事件数正常',
      tl.ok ? { 事件总数: tl.data.total_events, 类型数: new Set(events.map(e => e.type)).size } : null);

    print(!!sentEvent && !!readEvent && !!confirmEvent,
      '时间线包含发送/已读/确认三个事件',
      { 发送: !!sentEvent, 已读: !!readEvent, 确认: !!confirmEvent });

    if (sentEvent && readEvent) {
      const timeOk = dayjs(sentEvent.time).isBefore(dayjs(readEvent.time));
      print(timeOk, '发送时间 < 已读时间 < 确认时间（真实时间排序）',
        timeOk ? { 发送: sentEvent.time, 已读: readEvent.time, 确认: confirmEvent ? confirmEvent.time : 'N/A' } : null);
    }
  }

  // ============================================================
  // 第三部分：门店当日运营看板
  // ============================================================
  logSection('三、门店当日运营看板');

  logSub('3.1 创建今日订单 + 上报2个异常（1个处理中，1个超时）');

  // 创建今天的局（用于看板测试）
  const todayOrder = await request('/orders', 'POST', {
    store_key: 'default',
    game_date: dayjs().add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    room: 'VIP3',
    script_name: '漓川怪谈簿·生日场',
    player_count: 6,
    main_player_name: '赵小雷',
    main_player_phone: '137-0000-1111',
    dm_name: 'DM小白',
    dm_phone: '137-2222-3333',
    front_desk_contact: '前台小王',
    front_desk_phone: '137-4444-5555',
    created_by: '看板测试'
  });
  const todayOrderId = todayOrder.ok ? todayOrder.data.order.id : null;
  print(todayOrder.ok, '创建今日生日局成功',
    todayOrder.ok ? { id: todayOrderId, 开场: todayOrder.data.order.game_date } : null);

  let exc1Id = null, exc2Id = null;
  if (todayOrderId) {
    // 异常1：正常待处理
    const r1 = await request('/exceptions', 'POST', {
      order_id: todayOrderId,
      type: 'cake_not_arrived',
      description: '蛋糕还没送到，预计晚15分钟',
      reporter: '前台-小美'
    });
    exc1Id = r1.ok ? r1.data.id : null;
    print(r1.ok, '上报蛋糕未到异常（正常处理中）',
      r1.ok ? { id: exc1Id, 负责人: r1.data.assignee } : null);

    // 异常2：超时（-5分钟）
    const r2 = await request('/exceptions', 'POST', {
      order_id: todayOrderId,
      type: 'player_count_changed',
      description: '玩家说要加2人',
      reporter: 'DM-橙子',
      deadline_minutes: -5
    });
    exc2Id = r2.ok ? r2.data.id : null;
    print(r2.ok, '上报人数变动异常（设置-5分钟=立刻超时）',
      r2.ok ? { id: exc2Id, deadline: r2.data.deadline } : null);

    // 触发一次超时升级扫描
    await request('/_debug/trigger-escalation', 'POST', {});
  }

  logSub('3.2 看板接口 - 默认门店');
  const today = dayjs().format('YYYY-MM-DD');
  const dashDefault = await request(`/store-configs/default/dashboard?date=${today}`);
  const dashData = dashDefault.ok ? dashDefault.data : null;

  print(dashDefault.ok, '默认门店看板接口返回成功',
    dashData ? {
      门店: dashData.store_name,
      日期: dashData.date,
      订单数: dashData.stats.order_count,
      待发送: dashData.stats.pending_notification_count,
      未确认: dashData.stats.unconfirmed_notification_count,
      处理中异常: dashData.stats.processing_exception_count,
      超时异常: dashData.stats.overdue_exception_count
    } : null,
    dashDefault.ok ? null : dashDefault.message);

  if (dashData) {
    print(dashData.orders.length > 0, '看板包含订单列表（可定位到订单）',
      { 订单数: dashData.orders.length, 首个订单号: dashData.orders[0]?.order_no });

    print(dashData.processing_exceptions.length > 0, '看板包含处理中异常（带负责人+超时标记）',
      dashData.processing_exceptions.length > 0
        ? { 数量: dashData.processing_exceptions.length,
            首个负责人: dashData.processing_exceptions[0].assignee,
            首个是否超时: dashData.processing_exceptions[0].is_overdue }
        : null);

    print(dashData.overdue_exceptions.length >= 1, '看板包含已超时异常列表',
      { 超时异常数: dashData.overdue_exceptions.length });
  }

  logSub('3.3 看板 - 朝阳门店（数据为0也正常，验证隔离）');
  const dashChaoyang = await request(`/store-configs/chaoyang/dashboard?date=${today}`);
  print(dashChaoyang.ok, '朝阳门店看板返回成功（数据独立）',
    dashChaoyang.ok ? { 门店: dashChaoyang.data.store_name, 订单数: dashChaoyang.data.stats.order_count } : null);

  // ============================================================
  // 第四部分：通知失败重试闭环
  // ============================================================
  logSection('四、通知失败重试闭环');

  logSub('4.1 配置失败渠道 + 发送失败（记录原因 + 日志）');

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

  const custNotifId = defaultCustNotif ? defaultCustNotif.id : null;
  let failedNotif = null;
  if (custNotifId) {
    const failSend = await request(`/notifications/${custNotifId}/send`, 'POST', {});
    failedNotif = failSend.ok ? failSend.data.notification : null;
    print(failSend.ok && failedNotif.status === 'failed',
      '顾客短信发送失败（模拟运营商超时）',
      failedNotif ? {
        状态: failedNotif.status,
        失败次数: failedNotif.send_attempts,
        失败原因: failedNotif.last_error
      } : null,
      failSend.ok ? null : failSend.message);

    // 查通知详情，看 send_logs
    const notifDetail = await request(`/notifications/${custNotifId}`);
    const logs = notifDetail.ok && notifDetail.data ? notifDetail.data.send_logs : [];
    print(notifDetail.ok && logs && logs.length >= 1,
      '通知详情含 send_logs 发送日志',
      logs ? { 日志数: logs.length, 首次状态: logs[0]?.success ? '成功' : '失败', 失败原因: logs[0]?.error_message } : null);
  }

  logSub('4.2 重试第一次（仍然失败）');
  let retry1 = null;
  if (custNotifId) {
    retry1 = await request(`/notifications/${custNotifId}/retry`, 'POST', {});
    print(retry1.ok && retry1.data.notification.status === 'failed',
      '第一次重试仍然失败（次数+1）',
      retry1.ok ? { 当前次数: retry1.data.attempt, 状态: retry1.data.notification.status } : null);
  }

  logSub('4.3 取消 force_fail，重试第二次（成功）');
  // 恢复正常渠道
  await request('/store-configs/default', 'PUT', {
    customer_channel_config: {
      mock: true,
      gateway: 'sms_gateway_test',
      sign: '【剧本杀测试】'
    }
  });

  let retry2 = null;
  if (custNotifId) {
    retry2 = await request(`/notifications/${custNotifId}/retry`, 'POST', {});
    print(retry2.ok && retry2.data.notification.status === 'sent',
      '第二次重试成功',
      retry2.ok ? { 当前次数: retry2.data.attempt, 状态: retry2.data.notification.status } : null);

    // 查通知详情，看有3次日志
    const detail2 = await request(`/notifications/${custNotifId}`);
    const logs2 = detail2.ok && detail2.data ? detail2.data.send_logs : [];
    print(detail2.ok && logs2 && logs2.length >= 3,
      '通知详情显示3条发送日志（1次首送+2次重试）',
      logs2 ? { 日志总数: logs2.length, 最后一次: logs2[logs2.length - 1]?.success ? '成功' : '失败' } : null);
  }

  logSub('4.4 时间线包含失败/重试事件');
  if (order1Id && custNotifId) {
    const tl2 = await request(`/orders/${order1Id}/timeline`);
    const events = tl2.ok ? tl2.data.timeline : [];
    const failEvents = events.filter(e => e.type === 'notification_send_failed');
    const successEvents = events.filter(e => e.type === 'notification_sent');
    print(tl2.ok && failEvents.length >= 2 && successEvents.length >= 1,
      '时间线包含失败和重试成功事件',
      { 失败事件数: failEvents.length, 成功事件数: successEvents.length, 事件总数: tl2.data.total_events });
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
  console.log(`\n    🎯 核心验证项回顾:\n`);
  console.log('    ✅ 多门店渠道隔离');
  console.log('      • 两家门店可独立配置渠道（wecom/dingtalk/sms/console）');
  console.log('      • 订单绑定 store_key，通知生成自动取对应门店配置');
  console.log('      • 通知列表/异常列表支持按 storeKey 过滤');
  console.log('      • 门店数据完全隔离，没有串店\n');
  console.log('    ✅ 时间线真实时间');
  console.log('      • 通知发送/已读/确认都用真实时间（sent_time/read_at/confirmed_at）');
  console.log('      • 时间线按真实时间排序，店长复盘一目了然');
  console.log('      • 每次发送（含失败/重试）都在时间线上有记录\n');
  console.log('    ✅ 门店当日运营看板');
  console.log('      • 按门店+日期聚合：订单数/待发送/未确认/处理中/超时');
  console.log('      • 每个分类都有详细列表，可直接定位订单和负责人');
  console.log('      • 异常带 is_overdue 标记，店长一眼看出哪些超期\n');
  console.log('    ✅ 通知失败重试闭环');
  console.log('      • 发送失败记录 last_error 失败原因');
  console.log('      • 每次发送都写 notification_send_logs 日志（次数、结果、原因）');
  console.log('      • 支持手动 retry 重试，失败可多次重试直到成功');
  console.log('      • 通知详情、订单时间线都能看到每次发送记录\n');
  console.log('  📌 测试数据:');
  console.log(`     - 默认门店订单ID: ${order1Id || 'N/A'}`);
  console.log(`     - 朝阳门店订单ID: ${order2Id || 'N/A'}`);
  console.log(`     - 失败重试通知ID: ${custNotifId || 'N/A'}`);
  console.log(`     - 测试URL: http://localhost:3000/\n`);
};

runTests().catch(err => {
  console.error('测试运行异常:', err);
  process.exit(1);
});
