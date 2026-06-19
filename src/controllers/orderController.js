const dayjs = require('dayjs');
const { OrderModel, NotificationModel, ExceptionModel, ExceptionHandlerModel, StoreConfigModel } = require('../models');
const config = require('../config');

const validateOrderData = (data) => {
  const errors = [];
  const required = [
    'game_date', 'room', 'script_name', 'player_count',
    'main_player_name', 'dm_name', 'front_desk_contact'
  ];
  for (const field of required) {
    if (!data[field]) errors.push(`${field} 为必填项`);
  }
  if (data.player_count && (isNaN(Number(data.player_count)) || data.player_count < 1)) {
    errors.push('player_count 必须为正整数');
  }
  if (data.game_date) {
    const date = dayjs(data.game_date);
    if (!date.isValid()) errors.push('game_date 格式无效，应为 YYYY-MM-DD HH:mm:ss');
    else if (date.isBefore(dayjs())) errors.push('game_date 不能早于当前时间');
  }
  return errors;
};

const createNotificationsForOrder = (order) => {
  const gameDate = dayjs(order.game_date);
  const storeKey = order.store_key || 'default';
  const notifications = [];
  const defs = [
    {
      type: 'day_before',
      role: '前台',
      timeFn: () => gameDate.subtract(1, 'day').hour(config.notification.dayBefore.hours).minute(config.notification.dayBefore.minutes).second(0),
      template: config.notification.dayBefore.contentTemplate
    },
    {
      type: 'three_hours_before',
      role: 'DM',
      timeFn: () => gameDate.subtract(config.notification.threeHoursBefore.hours, 'hour'),
      template: config.notification.threeHoursBefore.contentTemplate
    },
    {
      type: 'one_hour_before',
      role: '顾客',
      timeFn: () => gameDate.subtract(config.notification.oneHourBefore.hours, 'hour'),
      template: config.notification.oneHourBefore.contentTemplate
    }
  ];
  for (const def of defs) {
    const scheduled = def.timeFn();
    if (scheduled.isAfter(dayjs())) {
      const channelInfo = StoreConfigModel.getChannelForRole(def.role, storeKey);
      let target = channelInfo.target;
      if (def.role === '顾客') target = order.main_player_phone || target;
      if (def.role === '前台') target = order.front_desk_contact + (order.front_desk_phone ? `(${order.front_desk_phone})` : '');
      if (def.role === 'DM') target = order.dm_name + (order.dm_phone ? `(${order.dm_phone})` : '');
      const created = NotificationModel.create({
        order_id: order.id,
        order_no: order.order_no,
        type: def.type,
        role: def.role,
        content: def.template(order),
        scheduled_time: scheduled.format('YYYY-MM-DD HH:mm:ss'),
        channel: channelInfo.type,
        channel_target: target
      });
      if (created) notifications.push(created);
    }
  }
  return notifications;
};

const regenerateNotifications = (order) => {
  NotificationModel.deleteByOrderId(order.id);
  return createNotificationsForOrder(order);
};

module.exports = {
  createOrder: (req, res) => {
    const errors = validateOrderData(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ code: 400, message: '参数校验失败', errors });
    }
    try {
      const order = OrderModel.create(req.body);
      const notifications = createNotificationsForOrder(order);
      res.json({
        code: 200,
        message: '创建成功',
        data: {
          order,
          notifications: notifications.map(n => ({
            id: n.id, type: n.type, role: n.role,
            scheduled_time: n.scheduled_time,
            channel: n.channel,
            channel_target: n.channel_target
          }))
        }
      });
    } catch (err) {
      res.status(500).json({ code: 500, message: err.message });
    }
  },

  getOrder: (req, res) => {
    const { id } = req.params;
    const order = OrderModel.getById(id);
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
    const notifications = NotificationModel.getByOrderId(id);
    const exceptions = ExceptionModel.getByOrderId(id);
    res.json({
      code: 200,
      data: {
        order,
        notifications: notifications.map(n => ({
          ...n,
          send_result_obj: n.send_result ? (() => { try { return JSON.parse(n.send_result); } catch (e) { return n.send_result; } })() : null
        })),
        exceptions,
        exception_handlers: ExceptionHandlerModel.getByOrderId(id)
      }
    });
  },

  getOrderTimeline: (req, res) => {
    const { id } = req.params;
    const result = OrderModel.getTimeline(id);
    if (!result) return res.status(404).json({ code: 404, message: '订单不存在' });
    res.json({
      code: 200,
      data: {
        order_summary: {
          order_no: result.order.order_no,
          store_key: result.order.store_key,
          script_name: result.order.script_name,
          room: result.order.room,
          game_date: result.order.game_date,
          main_player_name: result.order.main_player_name,
          player_count: result.order.player_count,
          dm_name: result.order.dm_name,
          status: result.order.status,
          cake_confirmed: result.order.cake_confirmed,
          decoration_confirmed: result.order.decoration_confirmed
        },
        total_events: result.total_events,
        timeline: result.timeline
      }
    });
  },

  updateOrder: (req, res) => {
    const { id } = req.params;
    const order = OrderModel.getById(id);
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
    try {
      const updated = OrderModel.update(id, req.body);
      let notifications = [];
      let regenerated = false;
      if (req.body.game_date) {
        notifications = regenerateNotifications(updated);
        regenerated = true;
      }
      res.json({
        code: 200,
        message: '更新成功',
        data: {
          order: updated,
          notifications_regenerated: regenerated,
          notifications
        }
      });
    } catch (err) {
      res.status(500).json({ code: 500, message: err.message });
    }
  },

  deleteOrder: (req, res) => {
    const { id } = req.params;
    const order = OrderModel.getById(id);
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
    OrderModel.delete(id);
    res.json({ code: 200, message: '删除成功' });
  },

  listOrders: (req, res) => {
    const { status, startDate, endDate, storeKey, page, pageSize } = req.query;
    const result = OrderModel.list({
      status, startDate, endDate, storeKey,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20
    });
    res.json({ code: 200, data: result });
  },

  confirmItem: (req, res) => {
    const { id } = req.params;
    const { item, confirmed } = req.body;
    const order = OrderModel.getById(id);
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
    if (!['cake', 'decoration'].includes(item)) {
      return res.status(400).json({ code: 400, message: 'item 只能是 cake 或 decoration' });
    }
    const field = item === 'cake' ? 'cake_confirmed' : 'decoration_confirmed';
    const updated = OrderModel.update(id, { [field]: confirmed ? 1 : 0 });
    res.json({ code: 200, message: '确认成功', data: updated });
  }
};
