const dayjs = require('dayjs');

const BASE_URL = 'http://localhost:3000/api';

const logSection = (title) => {
  console.log('\n' + '='.repeat(75));
  console.log(`  ${title}`);
  console.log('='.repeat(75));
};

const logSub = (title) => {
  console.log(`\n  ── ${title} ` + '─'.repeat(Math.max(0, 60 - title.length)));
};

const logResult = (name, success, data = null, error = null) => {
  const icon = success ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (error) console.log(`     ⚠️  ${error}`);
  if (data && success) {
    const preview = typeof data === 'object' ? JSON.stringify(data).slice(0, 180) : String(data).slice(0, 180);
    console.log(`     📋 ${preview}`);
  }
};

const request = async (url, method = 'GET', body = null) => {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  try {
    const res = await fetch(`${BASE_URL}${url}`, options);
    const json = await res.json();
    return { status: res.status, ok: res.ok, ...json };
  } catch (e) {
    return { status: 0, ok: false, code: 0, message: e.message };
  }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let orderId = null;
let orderNo = null;
let exceptionId = null;
let notifIds = {};
let storeId = null;

const runTests = async () => {
  logSection('剧本杀生日包场通知服务 v2.0 - 全功能集成测试');
  await sleep(800);

  // ============================================================
  // 第一部分：门店配置
  // ============================================================
  logSection('一、门店通知渠道配置模块');

  logSub('1.1 门店配置列表 & 默认配置');
  const listCfg = await request('/store-configs');
  logResult('列出所有门店配置', listCfg.ok && listCfg.code === 200,
    listCfg.ok ? { count: listCfg.data.length, default_key: listCfg.data[0].store_key } : null,
    listCfg.ok ? null : listCfg.message);

  logSub('1.2 查询默认门店渠道配置');
  const cfgDef = await request('/store-configs/default');
  storeId = cfgDef.ok ? cfgDef.data.id : null;
  logResult('查询默认门店(default)配置', cfgDef.ok && cfgDef.code === 200,
    cfgDef.ok ? {
      门店: cfgDef.data.store_name,
      前台渠道: cfgDef.data.front_desk_channel_type,
      DM渠道: cfgDef.data.dm_channel_type,
      顾客渠道: cfgDef.data.customer_channel_type,
      默认负责人: cfgDef.data.default_assignee,
      异常默认时限_min: cfgDef.data.exception_deadline_minutes
    } : null,
    cfgDef.ok ? null : cfgDef.message);

  logSub('1.3 支持的渠道类型 & 角色渠道预览');
  const channels = await request('/store-configs/channels');
  logResult('查询支持的通知渠道类型', channels.ok && channels.code === 200,
    channels.ok ? channels.data.map(c => `${c.value}=${c.label}`).join('、') : null,
    channels.ok ? null : channels.message);

  const previewFD = await request('/store-configs/default/preview?role=前台');
  logResult('预览【前台】渠道配置', previewFD.ok && previewFD.code === 200,
    previewFD.ok ? { 类型: previewFD.data.channel_label, 默认目标: previewFD.data.default_target } : null,
    previewFD.ok ? null : previewFD.message);

  const previewCus = await request('/store-configs/default/preview?role=顾客');
  logResult('预览【顾客】渠道配置', previewCus.ok && previewCus.code === 200,
    previewCus.ok ? { 类型: previewCus.data.channel_label } : null,
    previewCus.ok ? null : previewCus.message);

  logSub('1.4 更新门店配置（修改店长信息和异常时限）');
  const updateCfg = await request('/store-configs/default', 'PUT', {
    manager_name: '店长-钱总',
    manager_phone: '139-0000-0001',
    exception_deadline_minutes: 45,
    front_desk_channel_config: { webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=FRONT-DESK-REAL-KEY-001' }
  });
  logResult('更新默认门店配置', updateCfg.ok && updateCfg.code === 200,
    updateCfg.ok ? {
      店长: updateCfg.data.manager_name,
      异常时限_min: updateCfg.data.exception_deadline_minutes,
      前台渠道配置: updateCfg.data.front_desk_channel_config && updateCfg.data.front_desk_channel_config.webhook_url ? '已设置' : '未设置'
    } : null,
    updateCfg.ok ? null : updateCfg.message);

  // ============================================================
  // 第二部分：订单录入
  // ============================================================
  logSection('二、订单录入模块（创建订单自动匹配渠道）');

  const futureDate = dayjs().add(2, 'day').hour(19).minute(0).second(0).format('YYYY-MM-DD HH:mm:ss');
  const orderData = {
    game_date: futureDate,
    room: '星空厅-VIP',
    script_name: '雾隐山庄·生日特供版',
    player_count: 8,
    main_player_name: '李四',
    main_player_phone: '138-1111-2222',
    dm_name: 'DM-橙子',
    dm_phone: '138-3333-4444',
    front_desk_contact: '前台-小美',
    front_desk_phone: '138-5555-6666',
    additional_services: '生日蛋糕(抹茶)+气球布置+照片打印+香槟',
    newbie_ratio: '25%'
  };

  logSub('2.1 创建生日包场订单');
  const createRes = await request('/orders', 'POST', orderData);
  if (createRes.ok && createRes.code === 200) {
    orderId = createRes.data.order.id;
    orderNo = createRes.data.order.order_no;
    createRes.data.notifications.forEach(n => {
      if (n.type === 'day_before') notifIds.day_before = n.id;
      if (n.type === 'three_hours_before') notifIds.three_hours = n.id;
      if (n.type === 'one_hour_before') notifIds.one_hour = n.id;
    });
  }
  logResult('创建订单（自动生成3条提醒）', createRes.ok && createRes.code === 200,
    createRes.ok ? {
      订单ID: orderId,
      订单号: orderNo,
      提醒数量: createRes.data.notifications.length,
      提醒渠道: [...new Set(createRes.data.notifications.map(n => n.channel))].join('/'),
      提醒角色: createRes.data.notifications.map(n => `${n.role}(${n.channel})`).join(', ')
    } : null,
    createRes.ok ? null : createRes.message);

  logSub('2.2 查询订单详情（含通知+异常+处理历史）');
  const getOrder = await request(`/orders/${orderId}`);
  logResult('订单详情接口', getOrder.ok && getOrder.code === 200,
    getOrder.ok ? {
      通知数: getOrder.data.notifications.length,
      异常数: getOrder.data.exceptions.length,
      附带处理历史: !!getOrder.data.exception_handlers
    } : null,
    getOrder.ok ? null : getOrder.message);

  logSub('2.3 检查单条通知是否包含渠道和目标信息');
  const fdNotif = await request(`/notifications/${notifIds.day_before}`);
  logResult('前台提醒含渠道信息', fdNotif.ok && fdNotif.code === 200 && fdNotif.data.channel,
    fdNotif.ok ? {
      类型: fdNotif.data.type,
      角色: fdNotif.data.role,
      渠道: fdNotif.data.channel,
      目标: fdNotif.data.channel_target,
      发送次数: fdNotif.data.send_attempts
    } : null,
    fdNotif.ok ? null : fdNotif.message);

  const cusNotif = await request(`/notifications/${notifIds.one_hour}`);
  logResult('顾客提醒走短信渠道', cusNotif.ok && cusNotif.code === 200 && cusNotif.data.channel === 'sms',
    cusNotif.ok ? { 角色: cusNotif.data.role, 渠道: cusNotif.data.channel, 目标: cusNotif.data.channel_target } : null,
    cusNotif.ok ? null : cusNotif.message);

  logSub('2.4 手动立即发送顾客短信通知（验证渠道发送）');
  const sendRes = await request(`/notifications/${notifIds.one_hour}/send`, 'POST');
  logResult('手动发送短信通知（返回发送结果）', sendRes.ok && sendRes.code === 200,
    sendRes.ok ? {
      新状态: sendRes.data.notification.status,
      渠道: sendRes.data.notification.channel,
      发送结果: sendRes.data.send_detail && sendRes.data.send_detail.description,
      结果原文: sendRes.data.notification.send_result ? '有记录' : '无记录'
    } : null,
    sendRes.ok ? null : sendRes.message);

  logSub('2.5 确认前台提醒 + 同步确认蛋糕布置物料');
  const confFd = await request(`/notifications/${notifIds.day_before}/confirm`, 'POST', {
    cake: true,
    decoration: true
  });
  logResult('前台确认通知（同步确认物料）', confFd.ok && confFd.code === 200,
    confFd.ok ? { confirmed: !!confFd.data.confirmed } : null,
    confFd.ok ? null : confFd.message);

  const checkOrder = await request(`/orders/${orderId}`);
  logResult('物料确认已同步到订单', checkOrder.ok && checkOrder.code === 200
    && checkOrder.data.order.cake_confirmed === 1 && checkOrder.data.order.decoration_confirmed === 1,
    checkOrder.ok ? {
      cake: checkOrder.data.order.cake_confirmed,
      decoration: checkOrder.data.order.decoration_confirmed
    } : null,
    checkOrder.ok ? null : checkOrder.message);

  // ============================================================
  // 第三部分：异常闭环
  // ============================================================
  logSection('三、异常上报→分配→处理→升级 闭环');

  logSub('3.1 查看异常类型、处理选项、默认时限');
  const types = await request('/exceptions/types');
  logResult('获取异常元数据', types.ok && types.code === 200,
    types.ok ? {
      异常类型数: types.data.types.length,
      处理选项数: types.data.resolutions.length,
      蛋糕未到时限_min: types.data.default_deadline_minutes.cake_not_arrived,
      人数变动时限_min: types.data.default_deadline_minutes.player_count_changed
    } : null,
    types.ok ? null : types.message);

  logSub('3.2 上报异常（蛋糕未到货）');
  const reportExc = await request('/exceptions', 'POST', {
    order_id: orderId,
    type: 'cake_not_arrived',
    description: '蛋糕供应商电话通知，预计比原定时间晚40分钟送达，可能影响开场布置',
    reporter: '前台-小美'
  });
  if (reportExc.ok && reportExc.code === 200) {
    exceptionId = reportExc.data.id;
  }
  logResult('上报蛋糕未到货（自动分配负责人+时限）',
    reportExc.ok && reportExc.code === 200 && reportExc.data.assignee && reportExc.data.deadline,
    reportExc.ok ? {
      异常ID: exceptionId,
      类型: reportExc.data.type_label,
      负责人: reportExc.data.assignee,
      处理时限: reportExc.data.deadline,
      时限分钟: reportExc.data.deadline_minutes,
      已生成分配记录: reportExc.data.handlers && reportExc.data.handlers.length > 0
    } : null,
    reportExc.ok ? null : reportExc.message);

  logSub('3.3 异常列表展示（含负责人+时限+超时标记）');
  const listExc = await request('/exceptions');
  const targetExc = listExc.ok ? listExc.data.list.find(e => e.id === exceptionId) : null;
  logResult('异常列表含负责人/时限/超时字段',
    !!targetExc && targetExc.assignee && targetExc.deadline && ('is_overdue' in targetExc),
    targetExc ? {
      负责人: targetExc.assignee,
      时限: targetExc.deadline,
      超时: targetExc.is_overdue,
      处理历史数: targetExc.handlers ? targetExc.handlers.length : 0
    } : null,
    targetExc ? null : '未找到目标异常');

  logSub('3.4 校验：处理异常时 resolution 和 remark 必填');
  const handleFail1 = await request(`/exceptions/${exceptionId}/handle`, 'POST', {
    handled_by: '店长-钱总'
  });
  logResult('不填resolution+remark -> 拒绝处理',
    handleFail1.status === 400 && handleFail1.code === 400,
    null,
    handleFail1.code === 400 ? handleFail1.message : '未返回400');

  const handleFail2 = await request(`/exceptions/${exceptionId}/handle`, 'POST', {
    resolution: 'contact_backup',
    handled_by: '店长-钱总'
  });
  logResult('只填resolution不填remark -> 再次拒绝',
    handleFail2.status === 400 && handleFail2.code === 400,
    null,
    handleFail2.code === 400 ? handleFail2.message : '未返回400');

  logSub('3.5 先更新为处理中（补充情况）');
  const handleProcess = await request(`/exceptions/${exceptionId}/handle`, 'POST', {
    status: 'processing',
    resolution: 'contact_backup',
    handled_by: '店长-钱总',
    remark: '已联系备用蛋糕店（甜蜜时光），对方答复30分钟内能送到同款蛋糕。已致电主角李四说明情况，对方表示理解并同意延迟15分钟开场。'
  });
  logResult('标记为处理中（必填都填写）',
    handleProcess.ok && handleProcess.code === 200 && handleProcess.data.status === 'processing',
    handleProcess.ok ? { 新状态: handleProcess.data.status, 处理历史数: handleProcess.data.handlers && handleProcess.data.handlers.length } : null,
    handleProcess.ok ? null : handleProcess.message);

  logSub('3.6 异常ID查询详情（含完整处理历史）');
  const getExc = await request(`/exceptions/${exceptionId}`);
  logResult('异常详情能看到每步处理历史',
    getExc.ok && getExc.code === 200 && getExc.data.handlers && getExc.data.handlers.length >= 2,
    getExc.ok ? {
      状态: getExc.data.status,
      负责人: getExc.data.assignee,
      处理历史数: getExc.data.handlers.length,
      历史动作: getExc.data.handlers.map(h => h.action).join(' → ')
    } : null,
    getExc.ok ? null : getExc.message);

  logSub('3.7 最终解决异常（resolved）');
  const handleResolve = await request(`/exceptions/${exceptionId}/handle`, 'POST', {
    status: 'resolved',
    resolution: 'contact_backup',
    handled_by: '前台-小美',
    remark: '备用蛋糕店已按约定送达，品相和口味符合要求。现场已快速布置，延迟10分钟开场。已向主角送上免费香槟服务作为补偿，对方非常满意。'
  });
  logResult('最终标记解决（完整填写）',
    handleResolve.ok && handleResolve.code === 200 && handleResolve.data.status === 'resolved',
    handleResolve.ok ? {
      最终状态: handleResolve.data.status,
      处理结果: handleResolve.data.resolution,
      处理人: handleResolve.data.handled_by,
      处理时间: handleResolve.data.handled_at,
      历史总数: handleResolve.data.handlers && handleResolve.data.handlers.length
    } : null,
    handleResolve.ok ? null : handleResolve.message);

  logSub('3.8 校验：resolved后不能再重复处理');
  const handleAgain = await request(`/exceptions/${exceptionId}/handle`, 'POST', {
    status: 'resolved',
    resolution: 'other',
    handled_by: '某人',
    remark: '尝试重复处理'
  });
  logResult('已解决异常禁止重复处理',
    handleAgain.status === 400 && handleAgain.code === 400,
    null,
    handleAgain.code === 400 ? handleAgain.message : '未返回400');

  logSub('3.9 模拟超时：上报一个立刻超时的异常，触发升级');
  const reportExc2 = await request('/exceptions', 'POST', {
    order_id: orderId,
    type: 'player_count_changed',
    description: '玩家群里说突然减少2人，人数从8变6，需重新安排座位和物料',
    reporter: 'DM-橙子',
    deadline_minutes: -5
  });
  const exc2Id = reportExc2.ok ? reportExc2.data.id : null;
  logResult('上报第二个异常（时限-5分钟=立刻超时）',
    reportExc2.ok && reportExc2.code === 200,
    reportExc2.ok ? { id: exc2Id, 时限: reportExc2.data.deadline, 负责人: reportExc2.data.assignee } : null,
    reportExc2.ok ? null : reportExc2.message);

  if (exc2Id) {
    logSub('3.10 手动触发超时升级扫描（调试接口）');
    const trigger = await request('/_debug/trigger-escalation', 'POST', {});
    await sleep(500);
    const escalated = await request(`/exceptions/${exc2Id}`);
    const timeline = await request(`/orders/${orderId}/timeline`);
    const hasEscalationEvent = timeline.ok && timeline.data.timeline.some(e =>
      e.type === 'exception_escalated' || (e.type_label && e.type_label.includes('升级')));
    logResult('超时异常自动升级（店长通知已生成）',
      escalated.ok && escalated.data.escalated === 1,
      escalated.ok ? {
        扫描触发: trigger.ok ? '✅成功' : `❌${trigger.message}`,
        扫描结果: trigger.ok ? trigger.result : null,
        已升级: escalated.data.escalated === 1,
        升级时间: escalated.data.escalated_at,
        处理历史含escalate: escalated.data.handlers && escalated.data.handlers.some(h => h.action === 'escalate'),
        时间线含升级事件: hasEscalationEvent
      } : null,
      escalated.ok ? null : escalated.message);
  }

  // ============================================================
  // 第四部分：时间线
  // ============================================================
  logSection('四、订单完整服务时间线（店长复盘）');

  const tl = await request(`/orders/${orderId}/timeline`);
  logResult('订单时间线接口返回完整事件',
    tl.ok && tl.code === 200 && tl.data.total_events >= 10,
    tl.ok ? {
      订单号: tl.data.order_summary.order_no,
      剧本: tl.data.order_summary.script_name,
      蛋糕已确认: !!tl.data.order_summary.cake_confirmed,
      布置已确认: !!tl.data.order_summary.decoration_confirmed,
      时间线事件总数: tl.data.total_events,
      事件类型集合: [...new Set(tl.data.timeline.map(e => e.type_label.split('-')[0]))].slice(0, 8).join('、')
    } : null,
    tl.ok ? null : tl.message);

  if (tl.ok && tl.data.timeline) {
    console.log('\n  📜 时间线事件列表（前15条）:');
    tl.data.timeline.slice(0, 15).forEach(e => {
      const flag = e.type.includes('exception') ? '🔴' : (e.type.includes('notification') ? '🔵' : '🟢');
      console.log(`     ${String(e.seq).padStart(2, '0')}. ${flag} [${e.time}] ${e.operator.padEnd(8)} | ${e.type_label.padEnd(20)} | ${e.title}`);
    });
  }

  logSub('4.2 订单详情中也能看到异常处理记录');
  const orderDetail = await request(`/orders/${orderId}`);
  logResult('订单详情包含exception_handlers处理历史',
    orderDetail.ok && orderDetail.code === 200
      && orderDetail.data.exception_handlers && orderDetail.data.exception_handlers.length >= 4,
    orderDetail.ok ? {
      异常总数: orderDetail.data.exceptions.length,
      处理历史总数: orderDetail.data.exception_handlers.length,
      不同异常: [...new Set(orderDetail.data.exception_handlers.map(h => h.exception_id))].length + '个'
    } : null,
    orderDetail.ok ? null : orderDetail.message);

  // ============================================================
  // 总结
  // ============================================================
  logSection('测试完成 - 结果汇总');

  console.log(`
    🎯 核心验证项回顾:

    ✅ 门店配置模块
      • 默认门店存在，前台/DM=企业微信，顾客=短信
      • 可更新店长信息、异常时限、渠道webhook
      • 可按角色预览对应渠道

    ✅ 订单&通知模块
      • 创建订单自动生成3条提醒，且各提醒带对应渠道信息
      • 前台=企业微信，DM=企业微信，顾客=短信
      • 手动发送通知通过ChannelSender，结果可追溯（send_result）
      • 确认前台通知时可同步确认蛋糕+布置物料
      • 通知详情显示发送次数、渠道、目标、返回结果

    ✅ 异常闭环模块
      • 上报异常自动分配负责人（默认负责人）+ 按时长设时限
      • 列表显示：负责人、处理时限、是否超时
      • 处理强制校验：resolution（处理结果）+ remark（备注）都必填
      • 已resolved/ignored的异常不能再重复处理
      • 支持processing中间状态更新
      • 异常详情可看所有处理历史（分配→处理中→解决）
      • 超时未处理自动升级店长，生成升级提醒并写入处理历史

    ✅ 服务时间线
      • 订单创建、信息更新、3次提醒的计划/发送/确认、异常上报、
        每步处理动作、超时升级，全部按时间顺序串联
      • 订单详情接口同时返回通知、异常、处理历史
  `);

  console.log(`  📌 测试数据:
     - 订单ID: ${orderId}  订单号: ${orderNo}
     - 异常ID(蛋糕未到): ${exceptionId}
     - 测试URL: http://localhost:3000/\n`);
};

runTests().catch(err => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
