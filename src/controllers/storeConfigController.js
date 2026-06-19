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
      const allNotifs = NotificationModel.getByOrderIds(orderIds);
      pendingNotifications = allNotifs.filter(n => n.status === 'pending');
      unconfirmedNotifications = allNotifs.filter(n => n.status !== 'pending' && n.confirmed !== 1);

      const allExcs = ExceptionModel.getByOrderIds(orderIds);
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
  },

  dailyReport: (req, res) => {
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

    let totalNotifications = 0;
    let sentNotifications = 0;
    let failedNotifications = 0;
    let confirmedNotifications = 0;
    let confirmationTimes = [];
    let totalExceptions = 0;
    let resolvedExceptions = 0;
    let overdueExceptionCount = 0;
    let exceptionHandlingTimes = [];
    let riskOrders = [];

    if (orderIds.length > 0) {
      const allNotifs = NotificationModel.getByOrderIds(orderIds);
      totalNotifications = allNotifs.length;
      sentNotifications = allNotifs.filter(n => n.status === 'sent').length;
      failedNotifications = allNotifs.filter(n => n.status === 'failed').length;
      confirmedNotifications = allNotifs.filter(n => n.confirmed === 1).length;

      for (const n of allNotifs) {
        if (n.sent_time && n.confirmed_at) {
          const diff = dayjs(n.confirmed_at).diff(dayjs(n.sent_time), 'second');
          if (diff >= 0) confirmationTimes.push(diff);
        }
      }

      const allExcs = ExceptionModel.getByOrderIds(orderIds);
      totalExceptions = allExcs.length;
      resolvedExceptions = allExcs.filter(e => e.status === 'resolved' || e.status === 'ignored').length;
      const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
      overdueExceptionCount = allExcs.filter(e =>
        e.status !== 'resolved' && e.status !== 'ignored'
        && e.deadline && e.deadline <= now
      ).length;

      for (const e of allExcs) {
        if (e.handled_at && e.created_at) {
          const diff = dayjs(e.handled_at).diff(dayjs(e.created_at), 'second');
          if (diff >= 0) exceptionHandlingTimes.push(diff);
        }
      }

      for (const order of orders) {
        const risks = [];
        const orderNotifs = allNotifs.filter(n => n.order_id === order.id);
        const orderExcs = allExcs.filter(e => e.order_id === order.id);
        const hasFailed = orderNotifs.some(n => n.status === 'failed');
        const hasUnconfirmed = orderNotifs.some(n => n.status === 'sent' && n.confirmed !== 1);
        const hasOverdue = orderExcs.some(e =>
          e.status !== 'resolved' && e.status !== 'ignored'
          && e.deadline && e.deadline <= now
        );
        if (hasFailed) risks.push('通知发送失败');
        if (hasUnconfirmed) risks.push('通知未确认');
        if (hasOverdue) risks.push('异常超时未处理');
        if (orderExcs.filter(e => e.status !== 'resolved' && e.status !== 'ignored').length >= 2) risks.push('多异常并发');
        if (risks.length > 0) {
          riskOrders.push({
            order_id: order.id,
            order_no: order.order_no,
            game_date: order.game_date,
            room: order.room,
            script_name: order.script_name,
            main_player_name: order.main_player_name,
            dm_name: order.dm_name,
            risk_factors: risks,
            failed_notification_count: orderNotifs.filter(n => n.status === 'failed').length,
            unconfirmed_notification_count: orderNotifs.filter(n => n.status === 'sent' && n.confirmed !== 1).length,
            overdue_exception_count: orderExcs.filter(e =>
              e.status !== 'resolved' && e.status !== 'ignored' && e.deadline && e.deadline <= now
            ).length
          });
        }
      }
    }

    const avgConfirmationSeconds = confirmationTimes.length > 0
      ? Math.round(confirmationTimes.reduce((a, b) => a + b, 0) / confirmationTimes.length)
      : null;
    const avgHandlingSeconds = exceptionHandlingTimes.length > 0
      ? Math.round(exceptionHandlingTimes.reduce((a, b) => a + b, 0) / exceptionHandlingTimes.length)
      : null;

    const formatDuration = (seconds) => {
      if (seconds === null) return null;
      if (seconds < 60) return `${seconds}秒`;
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      if (m < 60) return `${m}分${s > 0 ? s + '秒' : ''}`;
      const h = Math.floor(m / 60);
      const rm = m % 60;
      return `${h}时${rm > 0 ? rm + '分' : ''}`;
    };

    res.json({
      code: 200,
      data: {
        store_key: storeKey,
        store_name: storeConfig.store_name,
        date: targetDate,
        summary: {
          order_count: orders.length,
          notification_stats: {
            total: totalNotifications,
            sent: sentNotifications,
            failed: failedNotifications,
            confirmed: confirmedNotifications,
            reach_rate: totalNotifications > 0
              ? Math.round(sentNotifications / totalNotifications * 100) + '%'
              : '0%',
            confirm_rate: sentNotifications > 0
              ? Math.round(confirmedNotifications / sentNotifications * 100) + '%'
              : '0%',
            avg_confirmation_time: formatDuration(avgConfirmationSeconds),
            avg_confirmation_seconds: avgConfirmationSeconds
          },
          exception_stats: {
            total: totalExceptions,
            resolved: resolvedExceptions,
            overdue: overdueExceptionCount,
            resolve_rate: totalExceptions > 0
              ? Math.round(resolvedExceptions / totalExceptions * 100) + '%'
              : '0%',
            avg_handling_time: formatDuration(avgHandlingSeconds),
            avg_handling_seconds: avgHandlingSeconds
          }
        },
        risk_orders: riskOrders,
        orders: orders.map(o => ({
          id: o.id,
          order_no: o.order_no,
          game_date: o.game_date,
          room: o.room,
          script_name: o.script_name,
          main_player_name: o.main_player_name,
          dm_name: o.dm_name,
          player_count: o.player_count,
          cake_confirmed: !!o.cake_confirmed,
          decoration_confirmed: !!o.decoration_confirmed,
          status: o.status
        }))
      }
    });
  }
};
