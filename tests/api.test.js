const dayjs = require('dayjs');

const BASE_URL = 'http://localhost:3000/api';

const logSection = (title) => {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70));
};

const logResult = (name, success, data = null, error = null) => {
  const icon = success ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (error) console.log(`   错误: ${error}`);
  if (data && success) console.log(`   结果: ${JSON.stringify(data).slice(0, 200)}`);
};

const request = async (url, method = 'GET', body = null) => {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${url}`, options);
  const json = await res.json();
  return { status: res.status, ok: res.ok, ...json };
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let createdOrderId = null;
let createdOrderNo = null;
let createdExceptionId = null;

const runTests = async () => {
  logSection('剧本杀生日包场通知服务 - API 集成测试');

  await sleep(1000);

  logSection('一、订单模块测试');

  const futureDate = dayjs().add(2, 'day').hour(19).minute(0).second(0).format('YYYY-MM-DD HH:mm:ss');

  const createRes = await request('/orders', 'POST', {
    game_date: futureDate,
    room: '星空厅',
    script_name: '雾隐山庄',
    player_count: 8,
    main_player_name: '张三',
    main_player_phone: '13800138000',
    dm_name: 'DM小李',
    dm_phone: '13900139000',
    front_desk_contact: '前台小王',
    front_desk_phone: '13700137000',
    additional_services: '生日蛋糕、气球布置、照片打印',
    newbie_ratio: '30%'
  });
  const createOk = createRes.ok && createRes.code === 200;
  if (createOk) {
    createdOrderId = createRes.data.order.id;
    createdOrderNo = createRes.data.order.order_no;
  }
  logResult('1.1 创建生日包场订单', createOk, createOk ? {
    order_id: createdOrderId,
    order_no: createdOrderNo,
    notifications_count: createRes.data.notifications.length
  } : null, createOk ? null : createRes.message);

  const getRes = await request(`/orders/${createdOrderId}`, 'GET');
  logResult('1.2 查询订单详情（含通知和异常）', getRes.ok && getRes.code === 200, getRes.ok ? {
    notifications: getRes.data.notifications.length,
    exceptions: getRes.data.exceptions.length
  } : null, getRes.ok ? null : getRes.message);

  const listRes = await request('/orders', 'GET');
  logResult('1.3 订单列表查询', listRes.ok && listRes.code === 200, listRes.ok ? {
    total: listRes.data.total,
    page: listRes.data.page
  } : null, listRes.ok ? null : listRes.message);

  const confirmRes = await request(`/orders/${createdOrderId}/confirm`, 'POST', {
    item: 'cake',
    confirmed: true
  });
  logResult('1.4 确认蛋糕已到位', confirmRes.ok && confirmRes.code === 200, confirmRes.ok ? {
    cake_confirmed: confirmRes.data.cake_confirmed
  } : null, confirmRes.ok ? null : confirmRes.message);

  const updateRes = await request(`/orders/${createdOrderId}`, 'PUT', {
    player_count: 9,
    additional_services: '生日蛋糕、气球布置、照片打印、香槟服务'
  });
  logResult('1.5 更新订单信息（玩家人数变更）', updateRes.ok && updateRes.code === 200, updateRes.ok ? {
    player_count: updateRes.data.order.player_count,
    notifications_regenerated: updateRes.data.notifications_regenerated
  } : null, updateRes.ok ? null : updateRes.message);

  logSection('二、通知模块测试');

  const notifListRes = await request('/notifications', 'GET');
  let notifications = [];
  if (notifListRes.ok && notifListRes.code === 200) {
    notifications = notifListRes.data.list;
  }
  logResult('2.1 查询通知列表', notifListRes.ok && notifListRes.code === 200, notifListRes.ok ? {
    total: notifListRes.data.total,
    roles: [...new Set(notifications.map(n => n.role))]
  } : null, notifListRes.ok ? null : notifListRes.message);

  let targetNotifId = null;
  const orderNotifs = notifications.filter(n => n.order_id === createdOrderId);
  if (orderNotifs.length > 0) {
    targetNotifId = orderNotifs[0].id;
  }

  if (targetNotifId) {
    const getNotifRes = await request(`/notifications/${targetNotifId}`, 'GET');
    logResult('2.2 查询单条通知详情', getNotifRes.ok && getNotifRes.code === 200, getNotifRes.ok ? {
      id: getNotifRes.data.id,
      role: getNotifRes.data.role,
      type: getNotifRes.data.type,
      scheduled_time: getNotifRes.data.scheduled_time
    } : null, getNotifRes.ok ? null : getNotifRes.message);

    const sendRes = await request(`/notifications/${targetNotifId}/send`, 'POST');
    logResult('2.3 手动立即发送通知', sendRes.ok && sendRes.code === 200, sendRes.ok ? {
      status: sendRes.data.status,
      sent_time: sendRes.data.sent_time
    } : null, sendRes.ok ? null : sendRes.message);

    const confirmNotifRes = await request(`/notifications/${targetNotifId}/confirm`, 'POST', {
      cake: true,
      decoration: false
    });
    logResult('2.4 确认通知（附带物料确认）', confirmNotifRes.ok && confirmNotifRes.code === 200, confirmNotifRes.ok ? {
      confirmed: confirmNotifRes.data.confirmed
    } : null, confirmNotifRes.ok ? null : confirmNotifRes.message);

    const readRes = await request(`/notifications/${targetNotifId}/read`, 'POST');
    logResult('2.5 标记通知为已读', readRes.ok && readRes.code === 200, readRes.ok ? {
      read_at: readRes.data.read_at
    } : null, readRes.ok ? null : readRes.message);
  } else {
    logResult('2.2 ~ 2.5 跳过（无可用通知）', true, null, null);
  }

  logSection('三、异常确认模块测试');

  const typesRes = await request('/exceptions/types', 'GET');
  logResult('3.1 获取异常类型列表', typesRes.ok && typesRes.code === 200, typesRes.ok ? {
    count: typesRes.data.length,
    types: typesRes.data.map(t => t.value)
  } : null, typesRes.ok ? null : typesRes.message);

  const reportRes = await request('/exceptions', 'POST', {
    order_id: createdOrderId,
    type: 'cake_not_arrived',
    description: '供应商反馈蛋糕可能延迟1小时送达，请做好预案',
    reporter: '前台小王'
  });
  if (reportRes.ok && reportRes.code === 200) {
    createdExceptionId = reportRes.data.id;
  }
  logResult('3.2 上报异常（蛋糕未到货）', reportRes.ok && reportRes.code === 200, reportRes.ok ? {
    exception_id: createdExceptionId,
    type_label: reportRes.data.type_label
  } : null, reportRes.ok ? null : reportRes.message);

  const getExcRes = await request(`/exceptions/${createdExceptionId}`, 'GET');
  logResult('3.3 查询异常详情', getExcRes.ok && getExcRes.code === 200, getExcRes.ok ? {
    status: getExcRes.data.status,
    reporter: getExcRes.data.reporter
  } : null, getExcRes.ok ? null : getExcRes.message);

  const handleRes = await request(`/exceptions/${createdExceptionId}/handle`, 'POST', {
    status: 'resolved',
    resolution: '已联系备用蛋糕店，30分钟内可送达同款蛋糕，费用不变',
    handled_by: '店长老刘',
    remark: '同时已告知主角可能延迟15分钟开场，对方表示理解'
  });
  logResult('3.4 处理异常（填写处理结果和备注）', handleRes.ok && handleRes.code === 200, handleRes.ok ? {
    new_status: handleRes.data.status,
    handled_by: handleRes.data.handled_by,
    handled_at: handleRes.data.handled_at
  } : null, handleRes.ok ? null : handleRes.message);

  const excListRes = await request('/exceptions', 'GET');
  logResult('3.5 查询异常列表', excListRes.ok && excListRes.code === 200, excListRes.ok ? {
    total: excListRes.data.total,
    statuses: [...new Set(excListRes.data.list.map(e => e.status))]
  } : null, excListRes.ok ? null : excListRes.message);

  logSection('四、时间节点调度验证');
  console.log('  通知调度器每分钟自动扫描一次待发送通知');
  console.log('  已为测试订单生成的通知节点：');
  const finalOrder = await request(`/orders/${createdOrderId}`, 'GET');
  if (finalOrder.ok && finalOrder.data) {
    finalOrder.data.notifications.forEach(n => {
      const typeLabel = {
        day_before: '开场前一天18:00（前台）',
        three_hours_before: '开场前3小时（DM）',
        one_hour_before: '开场前1小时（顾客）'
      }[n.type] || n.type;
      console.log(`    - [${n.status}] ${typeLabel} -> ${n.scheduled_time}`);
    });
  }

  logSection('测试完成');
  console.log(`\n测试订单ID: ${createdOrderId}`);
  console.log(`测试订单号: ${createdOrderNo}`);
  console.log(`测试异常ID: ${createdExceptionId}`);
  console.log('\n服务地址: http://localhost:3000');
  console.log('所有接口说明见根路径 / \n');
};

runTests().catch(err => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
