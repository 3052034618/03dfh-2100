const dayjs = require('dayjs');
const { NotificationModel, OrderModel, StoreConfigModel } = require('../models');
const ChannelSender = require('../services/channelSender');

module.exports = {
  listNotifications: (req, res) => {
    const { orderId, status, role, page, pageSize } = req.query;
    const result = NotificationModel.list({
      orderId: orderId ? Number(orderId) : undefined,
      status, role,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50
    });
    res.json({ code: 200, data: result });
  },

  getNotification: (req, res) => {
    const { id } = req.params;
    const notification = NotificationModel.getById(id);
    if (!notification) return res.status(404).json({ code: 404, message: '通知不存在' });
    res.json({
      code: 200,
      data: {
        ...notification,
        send_result_obj: notification.send_result ? (() => {
          try { return JSON.parse(notification.send_result); } catch (e) { return notification.send_result; }
        })() : null
      }
    });
  },

  markAsRead: (req, res) => {
    const { id } = req.params;
    const notification = NotificationModel.getById(id);
    if (!notification) return res.status(404).json({ code: 404, message: '通知不存在' });
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const curStatus = notification.status === 'pending' ? 'sent' : notification.status;
    const updated = NotificationModel.update(id, { read_at: now, status: curStatus });
    res.json({ code: 200, message: '已标记为已读', data: updated });
  },

  confirmNotification: (req, res) => {
    const { id } = req.params;
    const notification = NotificationModel.getById(id);
    if (!notification) return res.status(404).json({ code: 404, message: '通知不存在' });
    if (notification.role === '前台') {
      const { cake, decoration } = req.body;
      if (cake !== undefined) OrderModel.update(notification.order_id, { cake_confirmed: cake ? 1 : 0 });
      if (decoration !== undefined) OrderModel.update(notification.order_id, { decoration_confirmed: decoration ? 1 : 0 });
    }
    const updated = NotificationModel.markConfirmed(id);
    res.json({ code: 200, message: '确认成功', data: updated });
  },

  sendNow: async (req, res) => {
    const { id } = req.params;
    const notification = NotificationModel.getById(id);
    if (!notification) return res.status(404).json({ code: 404, message: '通知不存在' });
    const order = OrderModel.getById(notification.order_id);
    const channelInfo = StoreConfigModel.getChannelForRole(notification.role, 'default');
    let target = notification.channel_target || channelInfo.target;
    if (notification.role === '顾客' && order) target = order.main_player_phone || target;
    if (notification.role === '前台' && order) target = order.front_desk_contact + (order.front_desk_phone ? `(${order.front_desk_phone})` : '');
    if (notification.role === 'DM' && order) target = order.dm_name + (order.dm_phone ? `(${order.dm_phone})` : '');
    console.log('\n' + '='.repeat(70));
    console.log(`[手动发送通知] ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`  通知ID: ${id} | 类型: ${notification.type} | 角色: ${notification.role}`);
    console.log(`  渠道: ${channelInfo.type} | 目标: ${target}`);
    console.log('-'.repeat(70));
    let sendResult;
    try {
      sendResult = await ChannelSender.send(channelInfo.type, channelInfo.config, notification.content, target, order);
    } catch (err) {
      sendResult = {
        success: false,
        channel: channelInfo.type,
        target: target,
        result: err.message,
        description: `发送异常: ${err.message}`
      };
    }
    console.log(`  结果: ${sendResult.success ? '✅ 成功' : '❌ 失败'} - ${sendResult.description}`);
    console.log('='.repeat(70) + '\n');
    const updated = NotificationModel.recordSendResult(
      id, sendResult.success, sendResult.description, sendResult.channel, sendResult.target
    );
    res.json({
      code: 200,
      message: sendResult.success ? '发送成功' : '发送失败',
      data: {
        notification: updated,
        send_detail: sendResult
      }
    });
  }
};
