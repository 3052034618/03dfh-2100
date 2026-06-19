const cron = require('node-cron');
const dayjs = require('dayjs');
const { NotificationModel } = require('../models');
const config = require('../config');

class NotificationScheduler {
  constructor() {
    this.task = null;
  }

  pushNotification(notification) {
    const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss');
    console.log('\n' + '='.repeat(60));
    console.log(`[推送通知] ${timestamp}`);
    console.log(`  订单号: ${notification.order_no}`);
    console.log(`  通知ID: ${notification.id}`);
    console.log(`  通知类型: ${notification.type}`);
    console.log(`  接收角色: ${notification.role}`);
    console.log(`  计划时间: ${notification.scheduled_time}`);
    console.log('-'.repeat(60));
    console.log(notification.content);
    console.log('='.repeat(60) + '\n');
    return true;
  }

  async checkAndSend() {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const pendingList = NotificationModel.getPendingNotifications(now);
    let sentCount = 0;
    for (const notification of pendingList) {
      try {
        const success = this.pushNotification(notification);
        if (success) {
          NotificationModel.update(notification.id, {
            status: 'sent',
            sent_time: dayjs().format('YYYY-MM-DD HH:mm:ss')
          });
          sentCount++;
        }
      } catch (err) {
        console.error(`[推送失败] 通知ID: ${notification.id}, 错误: ${err.message}`);
      }
    }
    if (sentCount > 0) {
      console.log(`[调度器] ${now} 完成推送 ${sentCount} 条通知`);
    }
  }

  start() {
    if (this.task) return;
    this.task = cron.schedule(config.notification.checkInterval, () => {
      this.checkAndSend();
    });
    console.log(`[调度器] 通知调度服务已启动，检查频率: ${config.notification.checkInterval}`);
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
