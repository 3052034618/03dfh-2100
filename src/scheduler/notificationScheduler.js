const cron = require('node-cron');
const dayjs = require('dayjs');
const { NotificationModel, ExceptionModel, StoreConfigModel, OrderModel } = require('../models');
const ChannelSender = require('../services/channelSender');
const config = require('../config');

class NotificationScheduler {
  constructor() {
    this.task = null;
  }

  async dispatchNotification(notification, triggerType) {
    const order = OrderModel.getById(notification.order_id);
    const storeKey = order ? order.store_key : 'default';
    const channelInfo = StoreConfigModel.getChannelForRole(notification.role, storeKey);
    let target = channelInfo.target;
    if (notification.role === '顾客' && order) {
      target = order.main_player_phone || target;
    } else if (notification.role === '前台' && order) {
      target = order.front_desk_contact + (order.front_desk_phone ? `(${order.front_desk_phone})` : '');
    } else if (notification.role === 'DM' && order) {
      target = order.dm_name + (order.dm_phone ? `(${order.dm_phone})` : '');
    }
    const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const triggerLabel = triggerType === 'auto' ? '自动重试' : (triggerType === 'escalation_retry' ? '升级重试' : '推送通知');
    console.log('\n' + '='.repeat(70));
    console.log(`[${triggerLabel}] ${timestamp}`);
    console.log(`  门店: ${storeKey} | 订单号: ${notification.order_no} | 通知ID: ${notification.id}`);
    console.log(`  类型: ${notification.type} | 角色: ${notification.role}`);
    console.log(`  渠道: ${channelInfo.type} | 目标: ${target}`);
    console.log(`  触发方式: ${triggerType}`);
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
        description: `发送异常: ${err.message}`,
        error: err.message
      };
    }
    NotificationModel.recordSendResult(
      notification.id,
      sendResult.success,
      sendResult.description,
      sendResult.channel,
      sendResult.target,
      sendResult.success ? null : (sendResult.error || sendResult.description),
      triggerType || 'manual'
    );

    if (!sendResult.success && triggerType !== 'escalation_retry') {
      const retryConfig = StoreConfigModel.getRetryConfig(storeKey);
      const currentAutoRetry = (notification.auto_retry_count || 0) + (triggerType === 'auto' ? 1 : 0);
      if (currentAutoRetry < retryConfig.max_retries) {
        const nextRetryAt = dayjs().add(retryConfig.retry_interval_minutes, 'minute').format('YYYY-MM-DD HH:mm:ss');
        NotificationModel.update(notification.id, { next_retry_at: nextRetryAt });
        console.log(`  ⏳ 自动重试计划: 第 ${currentAutoRetry + 1}/${retryConfig.max_retries} 次，${nextRetryAt} 执行`);
      } else if (retryConfig.escalate_on_max_retries) {
        NotificationModel.update(notification.id, { next_retry_at: null });
        console.log(`  🚨 已达最大自动重试次数 (${retryConfig.max_retries})，升级至店长`);
        this._escalateFailedNotification(notification, order, storeKey);
      } else {
        NotificationModel.update(notification.id, { next_retry_at: null });
        console.log(`  ⛔ 已达最大自动重试次数 (${retryConfig.max_retries})，不再重试`);
      }
    }

    if (sendResult.success) {
      NotificationModel.update(notification.id, { next_retry_at: null });
    }

    console.log(`  发送结果: ${sendResult.success ? '✅ 成功' : '❌ 失败'}`);
    console.log(`  结果描述: ${sendResult.description}`);
    console.log('='.repeat(70) + '\n');
    return sendResult.success;
  }

  _escalateFailedNotification(notification, order, storeKey) {
    const storeConfig = StoreConfigModel.getByKey(storeKey);
    const managerName = storeConfig ? storeConfig.manager_name : '店长';
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    NotificationModel.create({
      order_id: notification.order_id,
      order_no: notification.order_no,
      type: 'exception_escalation',
      role: '店长',
      content: `【通知发送失败升级】\n订单号：${notification.order_no}\n剧本：${order ? order.script_name : '-'}\n通知类型：${notification.type}\n角色：${notification.role}\n渠道：${notification.channel}\n已自动重试 ${(notification.auto_retry_count || 0)} 次，均失败\n最后失败原因：${notification.last_error || '未知'}\n\n请店长手动处理。`,
      scheduled_time: now
    });
  }

  async checkAndSend() {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const pendingList = NotificationModel.getPendingNotifications(now);
    let sentCount = 0;
    for (const notification of pendingList) {
      try {
        const success = await this.dispatchNotification(notification, 'scheduled');
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

  async checkAutoRetries() {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const retryList = NotificationModel.getRetryableNotifications(now);
    let retriedCount = 0;
    for (const notification of retryList) {
      try {
        const success = await this.dispatchNotification(notification, 'auto');
        if (success) retriedCount++;
      } catch (err) {
        console.error(`[自动重试失败] 通知ID: ${notification.id}, 错误: ${err.message}`);
      }
    }
    if (retryList.length > 0) {
      console.log(`[调度器] ${now} 自动重试 ${retriedCount}/${retryList.length} 条通知`);
    }
    return { retried_count: retriedCount, total_retryable: retryList.length };
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
    const retryResult = await this.checkAutoRetries();
    const escalateResult = this.checkExceptionOverdue();
    return {
      timestamp: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      notifications: sendResult,
      retries: retryResult,
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
    console.log(`[调度器] 通知自动重试已启用`);
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
