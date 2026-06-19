const dayjs = require('dayjs');
const { StoreConfigModel, OrderModel, NotificationModel, ExceptionModel } = require('../models');

const CHANNEL_LABELS = {
  wecom: '企业微信群机器人',
  sms: '短信接口',
  dingtalk: '钉钉群机器人',
  console: '控制台输出'
};

module.exports = {
  list: (req, res) => {
    const list = StoreConfigModel.list();
    res.json({ code: 200, data: list });
  },

  get: (req, res) => {
    const { key } = req.params;
    const config = StoreConfigModel.getByKey(key || 'default');
    if (!config) {
      return res.status(404).json({ code: 404, message: '门店配置不存在' });
    }
    res.json({ code: 200, data: config });
  },

  create: (req, res) => {
    const { store_key, store_name } = req.body;
    if (!store_key || !store_name) {
      return res.status(400).json({ code: 400, message: 'store_key 和 store_name 为必填项' });
    }
    if (StoreConfigModel.getByKey(store_key)) {
      return res.status(400).json({ code: 400, message: `store_key 已存在` });
    }
    try {
      const created = StoreConfigModel.create(req.body);
      res.json({ code: 200, message: '创建成功', data: created });
    } catch (err) {
      res.status(500).json({ code: 500, message: err.message });
    }
  },

  update: (req, res) => {
    const { key } = req.params;
    const existing = StoreConfigModel.getByKey(key || 'default');
    if (!existing) {
      return res.status(404).json({ code: 404, message: '门店配置不存在' });
    }
    try {
      const updated = StoreConfigModel.update(existing.id, req.body);
      res.json({ code: 200, message: '更新成功', data: updated });
    } catch (err) {
      res.status(500).json({ code: 500, message: err.message });
    }
  },

  delete: (req, res) => {
    const { key } = req.params;
    const existing = StoreConfigModel.getByKey(key);
    if (!existing) {
      return res.status(404).json({ code: 404, message: '门店配置不存在' });
    }
    StoreConfigModel.delete(existing.id);
    res.json({ code: 200, message: '删除成功' });
  },

  channelTypes: (req, res) => {
    res.json({
      code: 200,
      data: Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))
    });
  },

  previewChannelForRole: (req, res) => {
    const { key } = req.params;
    const { role } = req.query;
    const info = StoreConfigModel.getChannelForRole(role, key || 'default');
    if (!info) {
      return res.status(400).json({ code: 400, message: '未找到对应渠道配置' });
    }
    res.json({
      code: 200,
      data: {
        role,
        channel_type: info.type,
        channel_label: CHANNEL_LABELS[info.type] || info.type,
        channel_config: info.config,
        default_target: info.target
      }
    });
  },

  dashboard: (req, res) => {
    const { key } = req.params;
    const { date } = req.query;
    const storeKey = key || 'default';
    const targetDate = date || dayjs().format('YYYY-MM-DD');

    const storeConfig = StoreConfigModel.getByKey(storeKey);
    if (!storeConfig) {
      return res.status(404).json({ code: 404, message: '门店配置不存在' });
    }

    const orders = OrderModel.getByDateAndStore(targetDate, storeKey);
    const orderIds = orders.map(o => o.id);

    let pendingNotifications = [];
    let unconfirmedNotifications = [];
    let processingExceptions = [];
    let overdueExceptions = [];

    if (orderIds.length > 0) {
      const notifListRes = NotificationModel.list({ storeKey, pageSize: 500 });
      const allNotifs = notifListRes.list || [];
      const dayStart = dayjs(targetDate).format('YYYY-MM-DD 00:00:00');
      const dayEnd = dayjs(targetDate).format('YYYY-MM-DD 23:59:59');
      pendingNotifications = allNotifs.filter(n =>
        n.status === 'pending' && n.scheduled_time >= dayStart && n.scheduled_time <= dayEnd
      );
      unconfirmedNotifications = allNotifs.filter(n =>
        n.status !== 'pending' && n.confirmed !== 1
      );

      const excListRes = ExceptionModel.list({ storeKey, pageSize: 500 });
      const allExcs = excListRes.list || [];
      processingExceptions = allExcs.filter(e =>
        e.status !== 'resolved' && e.status !== 'ignored'
      );
      const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
      overdueExceptions = allExcs.filter(e =>
        e.status !== 'resolved' && e.status !== 'ignored'
        && e.deadline && e.deadline <= now
      );
    }

    res.json({
      code: 200,
      data: {
        store_key: storeKey,
        store_name: storeConfig.store_name,
        date: targetDate,
        stats: {
          order_count: orders.length,
          pending_notification_count: pendingNotifications.length,
          unconfirmed_notification_count: unconfirmedNotifications.length,
          processing_exception_count: processingExceptions.length,
          overdue_exception_count: overdueExceptions.length
        },
        orders: orders.map(o => ({
          id: o.id,
          order_no: o.order_no,
          game_date: o.game_date,
          room: o.room,
          script_name: o.script_name,
          player_count: o.player_count,
          main_player_name: o.main_player_name,
          dm_name: o.dm_name,
          status: o.status,
          cake_confirmed: !!o.cake_confirmed,
          decoration_confirmed: !!o.decoration_confirmed
        })),
        pending_notifications: pendingNotifications.map(n => ({
          id: n.id,
          order_id: n.order_id,
          order_no: n.order_no,
          type: n.type,
          role: n.role,
          scheduled_time: n.scheduled_time,
          channel: n.channel,
          channel_target: n.channel_target
        })),
        unconfirmed_notifications: unconfirmedNotifications.map(n => ({
          id: n.id,
          order_id: n.order_id,
          order_no: n.order_no,
          type: n.type,
          role: n.role,
          sent_time: n.sent_time,
          channel: n.channel,
          send_attempts: n.send_attempts
        })),
        processing_exceptions: processingExceptions.map(e => ({
          id: e.id,
          order_id: e.order_id,
          order_no: e.order_no,
          type: e.type,
          description: e.description,
          status: e.status,
          assignee: e.assignee,
          deadline: e.deadline,
          is_overdue: e.deadline && e.deadline <= dayjs().format('YYYY-MM-DD HH:mm:ss'),
          escalated: !!e.escalated
        })),
        overdue_exceptions: overdueExceptions.map(e => ({
          id: e.id,
          order_id: e.order_id,
          order_no: e.order_no,
          type: e.type,
          description: e.description,
          assignee: e.assignee,
          deadline: e.deadline,
          escalated: !!e.escalated
        }))
      }
    });
  }
};
