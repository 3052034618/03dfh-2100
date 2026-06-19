const dayjs = require('dayjs');
const { NotificationModel, OrderModel } = require('../models');

module.exports = {
  listNotifications: (req, res) => {
    const { orderId, status, role, page, pageSize } = req.query;
    const result = NotificationModel.list({
      orderId: orderId ? Number(orderId) : undefined,
      status,
      role,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50
    });
    res.json({ code: 200, data: result });
  },

  getNotification: (req, res) => {
    const { id } = req.params;
    const notification = NotificationModel.getById(id);
    if (!notification) {
      return res.status(404).json({ code: 404, message: '通知不存在' });
    }
    res.json({ code: 200, data: notification });
  },

  markAsRead: (req, res) => {
    const { id } = req.params;
    const notification = NotificationModel.getById(id);
    if (!notification) {
      return res.status(404).json({ code: 404, message: '通知不存在' });
    }
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const updated = NotificationModel.update(id, { read_at: now, status: notification.status === 'pending' ? 'sent' : notification.status });
    res.json({ code: 200, message: '已标记为已读', data: updated });
  },

  confirmNotification: (req, res) => {
    const { id } = req.params;
    const notification = NotificationModel.getById(id);
    if (!notification) {
      return res.status(404).json({ code: 404, message: '通知不存在' });
    }
    if (notification.role === '前台') {
      const { cake, decoration } = req.body;
      if (cake !== undefined) {
        OrderModel.update(notification.order_id, { cake_confirmed: cake ? 1 : 0 });
      }
      if (decoration !== undefined) {
        OrderModel.update(notification.order_id, { decoration_confirmed: decoration ? 1 : 0 });
      }
    }
    const updated = NotificationModel.markConfirmed(id);
    res.json({ code: 200, message: '确认成功', data: updated });
  },

  sendNow: (req, res) => {
    const { id } = req.params;
    const notification = NotificationModel.getById(id);
    if (!notification) {
      return res.status(404).json({ code: 404, message: '通知不存在' });
    }
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const updated = NotificationModel.update(id, { status: 'sent', sent_time: now });
    console.log(`\n[手动发送通知] ID:${notification.id} | 角色:${notification.role} | 类型:${notification.type}`);
    console.log('--------------------------------------------------');
    console.log(notification.content);
    console.log('--------------------------------------------------\n');
    res.json({ code: 200, message: '发送成功', data: updated });
  }
};
