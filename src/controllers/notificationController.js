const dayjs = require('dayjs');
const { NotificationModel, OrderModel, StoreConfigModel } = require('../models');
const ChannelSender = require('../services/channelSender');

module.exports = {
  listNotifications: (req, res) => {
    const { orderId, status, role, storeKey, page, pageSize } = req.query;
    const result = NotificationModel.list({
      orderId: orderId ? Number(orderId) : undefined,
      status, role, storeKey,
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
    const curStatus = notification.status === 'pending' ? 'sent' : notification.status;
    const updated = NotificationModel.update(id, { status: curStatus });
    NotificationModel.markAsRead(id);
    const refreshed = NotificationModel.getById(id);
    res.json({ code: 200, message: '已标记为已读', data: refreshed });
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
    NotificationModel.markConfirmed(id);
    const updated = NotificationModel.getById(id);
    res.json({ code: 200, message: '确认成功', data: updated });
  },

  sendNow: async (req, res) => {
    const { id } = req.params;
    const notification = NotificationModel.getById(id);
    if (!notification) return res.status(404).json({ code: 404, message: '通知不存在' });
    const order = OrderModel.getById(notification.order_id);
    const storeKey = order ? order.store_key : 'default';
    const channelInfo = StoreConfigModel.getChannelForRole(notification.role, storeKey);
    let target = notification.channel_target || channelInfo.target;
    if (notification.role === '顾客' && order) target = order.main_player_phone || target;
    if (notification.role === '前台' && order) target = order.front_desk_contact + (order.front_desk_phone ? `(${order.front_desk_phone})` : '');
    if (notification.role === 'DM' && order) target = order.dm_name + (order.dm_phone ? `(${order.dm_phone})` : '');
    console.log('\n' + '='.repeat(70));
    console.log(`[手动发送通知] ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`  通知ID: ${id} | 类型: ${notification.type} | 角色: ${notification.role}`);
    console.log(`  门店: ${storeKey} | 渠道: ${channelInfo.type} | 目标: ${target}`);
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
      id, sendResult.success, sendResult.description, sendResult.channel, sendResult.target,
      sendResult.success ? null : (sendResult.error || sendResult.description)
    );
    res.json({
      code: 200,
      message: sendResult.success ? '发送成功' : '发送失败',
      data: {
        notification: updated,
        send_detail: sendResult
      }
    });
  },

  retrySend: async (req, res) => {
    const { id } = req.params;
    const notification = NotificationModel.getById(id);
    if (!notification) return res.status(404).json({ code: 404, message: '通知不存在' });
    if (notification.status === 'sent' && notification.send_attempts > 0) {
      return res.status(400).json({ code: 400, message: '通知已发送成功，无需重试' });
    }
    const order = OrderModel.getById(notification.order_id);
    const storeKey = order ? order.store_key : 'default';
    const channelInfo = StoreConfigModel.getChannelForRole(notification.role, storeKey);
    let target = notification.channel_target || channelInfo.target;
    if (notification.role === '顾客' && order) target = order.main_player_phone || target;
    if (notification.role === '前台' && order) target = order.front_desk_contact + (order.front_desk_phone ? `(${order.front_desk_phone})` : '');
    if (notification.role === 'DM' && order) target = order.dm_name + (order.dm_phone ? `(${order.dm_phone})` : '');
    const attemptNo = (notification.send_attempts || 0) + 1;
    console.log('\n' + '='.repeat(70));
    console.log(`[重试发送通知] 第 ${attemptNo} 次 | ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`  通知ID: ${id} | 类型: ${notification.type} | 角色: ${notification.role}`);
    console.log(`  门店: ${storeKey} | 渠道: ${channelInfo.type} | 目标: ${target}`);
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
      id, sendResult.success, sendResult.description, sendResult.channel, sendResult.target,
      sendResult.success ? null : (sendResult.error || sendResult.description)
    );
    res.json({
      code: 200,
      message: sendResult.success ? '重试成功' : '重试失败',
      data: {
        attempt: attemptNo,
        notification: updated,
        send_detail: sendResult
      }
    });
  }
};
