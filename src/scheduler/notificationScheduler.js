const cron = require('node-cron');
const dayjs = require('dayjs');
const { NotificationModel, ExceptionModel, StoreConfigModel, OrderModel } = require('../models');
const ChannelSender = require('../services/channelSender');
const config = require('../config');

class NotificationScheduler {
  constructor() {
    this.task = null;
  }

  async dispatchNotification(notification) {
    const channelInfo = StoreConfigModel.getChannelForRole(notification.role, 'default');
    const order = OrderModel.getById(notification.order_id);
    let target = channelInfo.target;
    if (notification.role === '顾客' && order) {
      target = order.main_player_phone || target;
    } else if (notification.role === '前台' && order) {
      target = order.front_desk_contact + (order.front_desk_phone ? `(${order.front_desk_phone})` : '');
    } else if (notification.role === 'DM' && order) {
      target = order.dm_name + (order.dm_phone ? `(${order.dm_phone})` : '');
    }
    const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss');
    console.log('\n' + '='.repeat(70));
    console.log(`[推送通知] ${timestamp}`);
    console.log(`  订单号: ${notification.order_no} | 通知ID: ${notification.id}`);
    console.log(`  类型: ${notification.type} | 角色: ${notification.role}`);
    console.log(`  渠道: ${channelInfo.type} | 目标: ${target}`);
    console.log(`  计划时间: ${notification.scheduled_time}`);
    console.log('-'.repeat(70));
    let sendResult;
    try {
      sendResult = await ChannelSender.send(
        channelInfo.type,
        channelInfo.config,
        notification.content,
        target,
        order
      );
    } catch (err) {
      sendResult = {
        success: false,
        channel: channelInfo.type,
        target: target,
        result: err.message,
        description: `发送异常: ${err.message}`
      };
    }
    NotificationModel.recordSendResult(
      notification.id,
      sendResult.success,
      sendResult.description,
      sendResult.channel,
      sendResult.target
    );
    console.log(`  发送结果: ${sendResult.success ? '✅ 成功' : '❌ 失败'}`);
    console.log(`  结果描述: ${sendResult.description}`);
    console.log('='.repeat(70) + '\n');
    return sendResult.success;
  }

  async checkAndSend() {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const pendingList = NotificationModel.getPendingNotifications(now);
    let sentCount = 0;
    for (const notification of pendingList) {
      try {
        const success = await this.dispatchNotification(notification);
        if (success) sentCount++;
      } catch (err) {
        console.error(`[推送失败] 通知ID: ${notification.id}, 错误: ${err.message}`);
      }
    }
    if (sentCount > 0) {
      console.log(`[调度器] ${now} 完成推送 ${sentCount}/${pendingList.length} 条通知`);
    }
    return { sent_count: sentCount, total_pending: pendingList.length };
  }

  checkExceptionOverdue() {
    const overdueList = ExceptionModel.getOverdue();
    let escalatedCount = 0;
    if (overdueList.length === 0) return { escalated_count: 0, total_overdue: 0 };
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    console.log(`[调度器] ${now} 扫描到 ${overdueList.length} 条超时未处理异常`);
    for (const exc of overdueList) {
      const updated = ExceptionModel.escalate(exc.id);
      if (updated && updated.escalated) {
        escalatedCount++;
        console.log(`  ⚠️  异常ID: ${exc.id} (订单: ${exc.order_no}) 已自动升级至店长`);
      }
    }
    return { escalated_count: escalatedCount, total_overdue: overdueList.length };
  }

  async tick() {
    const sendResult = await this.checkAndSend();
    const escalateResult = this.checkExceptionOverdue();
    return {
      timestamp: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      notifications: sendResult,
      exceptions: escalateResult
    };
  }

  start() {
    if (this.task) return;
    this.task = cron.schedule(config.notification.checkInterval, () => {
      this.tick();
    });
    console.log(`[调度器] 通知调度服务已启动，检查频率: ${config.notification.checkInterval}`);
    console.log(`[调度器] 异常超时升级扫描已启用`);
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('[调度器] 通知调度服务已停止');
    }
  }
}

module.exports = new NotificationScheduler();
