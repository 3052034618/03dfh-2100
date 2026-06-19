const { run, get, all } = require('../db');
const dayjs = require('dayjs');
const { v4: uuidv4 } = require('uuid');

const generateOrderNo = () => {
  return 'BR' + dayjs().format('YYYYMMDDHHmmss') + uuidv4().slice(0, 4).toUpperCase();
};

const tryParseJSON = (str) => {
  if (!str) return null;
  try { return JSON.parse(str); } catch (e) { return str; }
};

const StoreConfigModel = {
  list() {
    const rows = all('SELECT * FROM store_configs ORDER BY id ASC');
    return rows.map(r => this._format(r));
  },

  getByKey(storeKey = 'default') {
    const row = get('SELECT * FROM store_configs WHERE store_key = ?', [storeKey]);
    return row ? this._format(row) : null;
  },

  getById(id) {
    const row = get('SELECT * FROM store_configs WHERE id = ?', [id]);
    return row ? this._format(row) : null;
  },

  _format(row) {
    return {
      ...row,
      front_desk_channel_config: tryParseJSON(row.front_desk_channel_config),
      dm_channel_config: tryParseJSON(row.dm_channel_config),
      customer_channel_config: tryParseJSON(row.customer_channel_config),
      retry_config: tryParseJSON(row.retry_config)
    };
  },

  create(data) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    run(`
      INSERT INTO store_configs (
        store_key, store_name, address,
        front_desk_channel_type, front_desk_channel_config,
        dm_channel_type, dm_channel_config,
        customer_channel_type, customer_channel_config,
        manager_phone, manager_name, default_assignee, exception_deadline_minutes,
        retry_config,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.store_key, data.store_name, data.address || null,
      data.front_desk_channel_type || 'wecom',
      data.front_desk_channel_config ? JSON.stringify(data.front_desk_channel_config) : null,
      data.dm_channel_type || 'wecom',
      data.dm_channel_config ? JSON.stringify(data.dm_channel_config) : null,
      data.customer_channel_type || 'sms',
      data.customer_channel_config ? JSON.stringify(data.customer_channel_config) : null,
      data.manager_phone || null, data.manager_name || null,
      data.default_assignee || null, data.exception_deadline_minutes || 60,
      data.retry_config ? JSON.stringify(data.retry_config) : null,
      now, now
    ]);
    const row = get('SELECT MAX(id) as max_id FROM store_configs');
    return this.getById(row ? row.max_id : null);
  },

  update(id, data) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const fields = [];
    const values = [];
    const allowed = [
      'store_key', 'store_name', 'address',
      'front_desk_channel_type', 'dm_channel_type', 'customer_channel_type',
      'manager_phone', 'manager_name', 'default_assignee', 'exception_deadline_minutes'
    ];
    const jsonFields = [
      'front_desk_channel_config', 'dm_channel_config', 'customer_channel_config',
      'retry_config'
    ];
    for (const field of allowed) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(data[field]);
      }
    }
    for (const field of jsonFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(typeof data[field] === 'string' ? data[field] : JSON.stringify(data[field]));
      }
    }
    if (fields.length === 0) return this.getById(id);
    fields.push('updated_at = ?');
    values.push(now, id);
    run(`UPDATE store_configs SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getById(id);
  },

  delete(id) {
    run('DELETE FROM store_configs WHERE id = ?', [id]);
    return { changes: 1 };
  },

  getChannelForRole(role, storeKey = 'default') {
    const cfg = this.getByKey(storeKey);
    if (!cfg) return { type: 'console', config: null };
    if (role === '前台') {
      return { type: cfg.front_desk_channel_type, config: cfg.front_desk_channel_config, target: cfg.front_desk_contact || null };
    } else if (role === 'DM') {
      return { type: cfg.dm_channel_type, config: cfg.dm_channel_config, target: cfg.dm_name || null };
    } else if (role === '顾客') {
      return { type: cfg.customer_channel_type, config: cfg.customer_channel_config, target: 'main_player_phone' };
    } else if (role === '店长') {
      return { type: 'wecom', config: cfg.dm_channel_config, target: cfg.manager_name };
    }
    return { type: 'console', config: null };
  },

  getDefaultAssignee(storeKey = 'default') {
    const cfg = this.getByKey(storeKey);
    return cfg ? cfg.default_assignee : null;
  },

  getDeadlineMinutes(storeKey = 'default') {
    const cfg = this.getByKey(storeKey);
    return cfg && cfg.exception_deadline_minutes ? cfg.exception_deadline_minutes : 60;
  },

  getRetryConfig(storeKey = 'default') {
    const cfg = this.getByKey(storeKey);
    const defaults = { max_retries: 3, retry_interval_minutes: 5, escalate_on_max_retries: true };
    if (!cfg || !cfg.retry_config) return defaults;
    const rc = cfg.retry_config;
    if (rc && typeof rc === 'object' && rc.max_retries !== undefined) {
      return { ...defaults, ...rc };
    }
    return defaults;
  },

  getRetryConfigByChannel(storeKey = 'default', channelType = 'sms') {
    const cfg = this.getByKey(storeKey);
    const channelDefaults = {
      sms: { max_retries: 3, retry_interval_minutes: 5, escalate_on_max_retries: true },
      wecom: { max_retries: 2, retry_interval_minutes: 3, escalate_on_max_retries: false },
      dingtalk: { max_retries: 2, retry_interval_minutes: 3, escalate_on_max_retries: false },
      console: { max_retries: 1, retry_interval_minutes: 1, escalate_on_max_retries: false }
    };
    const defaults = channelDefaults[channelType] || channelDefaults.sms;
    if (!cfg || !cfg.retry_config) return defaults;
    const rc = cfg.retry_config;
    if (rc && typeof rc === 'object' && rc[channelType]) {
      return { ...defaults, ...rc[channelType] };
    }
    if (rc && typeof rc === 'object' && rc.max_retries !== undefined) {
      return { ...defaults, ...rc };
    }
    return defaults;
  }
};

const OrderModel = {
  create(data) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const orderNo = generateOrderNo();
    run(`
      INSERT INTO orders (
        order_no, store_key, game_date, room, script_name, player_count,
        main_player_name, main_player_phone, dm_name, dm_phone,
        front_desk_contact, front_desk_phone, additional_services,
        newbie_ratio, status, cake_confirmed, decoration_confirmed,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      orderNo, data.store_key || 'default', data.game_date, data.room, data.script_name, data.player_count,
      data.main_player_name, data.main_player_phone || null, data.dm_name, data.dm_phone || null,
      data.front_desk_contact, data.front_desk_phone || null, data.additional_services || null,
      data.newbie_ratio || null, 'pending', data.cake_confirmed || 0, data.decoration_confirmed || 0,
      now, now
    ]);
    return this.getByOrderNo(orderNo);
  },

  update(id, data) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const fields = [];
    const values = [];
    const allowedFields = [
      'store_key', 'game_date', 'room', 'script_name', 'player_count',
      'main_player_name', 'main_player_phone', 'dm_name', 'dm_phone',
      'front_desk_contact', 'front_desk_phone', 'additional_services',
      'newbie_ratio', 'status', 'cake_confirmed', 'decoration_confirmed'
    ];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(data[field]);
      }
    }
    if (fields.length === 0) return this.getById(id);
    fields.push('updated_at = ?');
    values.push(now, id);
    run(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getById(id);
  },

  delete(id) {
    run('DELETE FROM orders WHERE id = ?', [id]);
    run('DELETE FROM notifications WHERE order_id = ?', [id]);
    run('DELETE FROM notification_send_logs WHERE order_id = ?', [id]);
    run('DELETE FROM exceptions WHERE order_id = ?', [id]);
    run('DELETE FROM exception_handlers WHERE order_id = ?', [id]);
    return { changes: 1 };
  },

  getById(id) {
    return get('SELECT * FROM orders WHERE id = ?', [id]);
  },

  getByOrderNo(orderNo) {
    return get('SELECT * FROM orders WHERE order_no = ?', [orderNo]);
  },

  list({ status, startDate, endDate, storeKey, page = 1, pageSize = 20 } = {}) {
    const conditions = [];
    const values = [];
    if (status) { conditions.push('status = ?'); values.push(status); }
    if (startDate) { conditions.push('game_date >= ?'); values.push(startDate); }
    if (endDate) { conditions.push('game_date <= ?'); values.push(endDate); }
    if (storeKey) { conditions.push('store_key = ?'); values.push(storeKey); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRow = get(`SELECT COUNT(*) as total FROM orders ${where}`, values);
    const total = countRow ? countRow.total : 0;
    const offset = (page - 1) * pageSize;
    const list = all(
      `SELECT * FROM orders ${where} ORDER BY game_date DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );
    return { total, page, pageSize, list };
  },

  getUpcomingOrders(hoursAhead = 48) {
    const now = dayjs();
    const endTime = now.add(hoursAhead, 'hour').format('YYYY-MM-DD HH:mm:ss');
    const startTime = now.format('YYYY-MM-DD HH:mm:ss');
    return all(
      `SELECT * FROM orders WHERE game_date >= ? AND game_date <= ? AND status != 'cancelled' ORDER BY game_date ASC`,
      [startTime, endTime]
    );
  },

  getByDateAndStore(date, storeKey) {
    const startOfDay = dayjs(date).format('YYYY-MM-DD 00:00:00');
    const endOfDay = dayjs(date).format('YYYY-MM-DD 23:59:59');
    const conditions = ['game_date >= ?', 'game_date <= ?'];
    const values = [startOfDay, endOfDay];
    if (storeKey) {
      conditions.push('store_key = ?');
      values.push(storeKey);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    return all(
      `SELECT * FROM orders ${where} ORDER BY game_date ASC`,
      values
    );
  },

  getTimeline(id) {
    const order = this.getById(id);
    if (!order) return null;
    const events = [];

    events.push({
      time: order.created_at,
      type: 'order_created',
      type_label: '订单创建',
      title: '订单创建',
      content: `订单号 ${order.order_no} 已录入，剧本《${order.script_name}》${order.game_date} 在 ${order.room} 开场`,
      operator: order.front_desk_contact,
      icon: '🟢'
    });

    if (order.updated_at && order.updated_at !== order.created_at) {
      events.push({
        time: order.updated_at,
        type: 'order_updated',
        type_label: '订单更新',
        title: '订单信息更新',
        content: `玩家 ${order.player_count} 人，主角 ${order.main_player_name}，DM：${order.dm_name}`,
        operator: order.front_desk_contact,
        icon: '🟢'
      });
    }

    const notifications = NotificationModel.getByOrderId(id);
    for (const n of notifications) {
      const typeLabel = {
        day_before: '开场前一天提醒',
        three_hours_before: '开场前3小时提醒',
        one_hour_before: '开场前1小时提醒',
        exception_escalation: '异常超时升级提醒'
      }[n.type] || n.type;
      const channelLabel = { wecom: '企业微信', sms: '短信', dingtalk: '钉钉', console: '控制台' }[n.channel] || n.channel;

      events.push({
        time: n.scheduled_time,
        type: 'notification_scheduled',
        type_label: `${typeLabel}-计划`,
        title: `${typeLabel}（${n.role}）`,
        content: `计划通过 ${channelLabel || '默认渠道'} 发送至 ${n.channel_target || '-'}`,
        operator: '系统',
        icon: '🔵'
      });

      if (n.send_logs && n.send_logs.length > 0) {
        for (const log of n.send_logs) {
          const logChannelLabel = { wecom: '企业微信', sms: '短信', dingtalk: '钉钉', console: '控制台' }[log.channel] || log.channel;
          const statusLabel = log.success ? '发送成功' : '发送失败';
          const triggerLabel = log.trigger_type === 'auto' ? '自动重试' : (log.trigger_type === 'scheduled' ? '定时推送' : '手动操作');
          const detail = log.success
            ? `第 ${log.attempt_no} 次发送（${triggerLabel}）：${statusLabel}，渠道：${logChannelLabel}，结果：${log.result_text || 'OK'}`
            : `第 ${log.attempt_no} 次发送（${triggerLabel}）：${statusLabel}，渠道：${logChannelLabel}，原因：${log.error_message || log.result_text || '未知'}`;
          events.push({
            time: log.sent_at,
            type: log.success ? 'notification_sent' : 'notification_send_failed',
            type_label: `${typeLabel}-${log.success ? '已发送' : '发送失败'}（${triggerLabel}）`,
            title: `${typeLabel} ${statusLabel}（第${log.attempt_no}次·${triggerLabel}）`,
            content: detail,
            operator: '系统',
            meta: { attempt: log.attempt_no, log_id: log.id, trigger_type: log.trigger_type },
            icon: log.success ? '🔵' : '🟡'
          });
        }
      } else if (n.sent_time) {
        events.push({
          time: n.sent_time,
          type: 'notification_sent',
          type_label: `${typeLabel}-已发送`,
          title: `${typeLabel} 已发送（${n.role}）`,
          content: `通过 ${channelLabel || n.channel} 发送，发送结果：${n.send_result || '成功'}`,
          operator: '系统',
          icon: '🔵'
        });
      }

      if (n.read_at) {
        events.push({
          time: n.read_at,
          type: 'notification_read',
          type_label: `${typeLabel}-已读`,
          title: `${n.role} 已读提醒`,
          content: n.send_result || '已确认接收',
          operator: n.role,
          icon: '🔵'
        });
      }

      if (n.confirmed && n.confirmed_at) {
        const confirmDetail = n.role === '前台'
          ? '前台已确认核对：蛋糕和布置物料已核对确认'
          : `${n.role} 已确认收到并按要求准备`;
        events.push({
          time: n.confirmed_at,
          type: 'notification_confirmed',
          type_label: `${typeLabel}-已确认`,
          title: `${n.role} 确认了提醒`,
          content: confirmDetail,
          operator: n.role,
          icon: '🔵'
        });
      }
    }

    const exceptions = ExceptionModel.getByOrderId(id);
    const EXCEPTION_TYPE_LABELS = {
      cake_not_arrived: '蛋糕未到货',
      player_count_changed: '玩家人数变动',
      main_player_time_changed: '主角临时改时间',
      decoration_issue: '布置物料问题',
      dm_unavailable: 'DM临时无法到场',
      other: '其他问题'
    };
    for (const e of exceptions) {
      events.push({
        time: e.created_at,
        type: 'exception_reported',
        type_label: '异常上报',
        title: `异常上报：${EXCEPTION_TYPE_LABELS[e.type] || e.type}`,
        content: e.description,
        operator: e.reporter,
        meta: { exception_id: e.id, assignee: e.assignee, deadline: e.deadline },
        icon: '🔴'
      });
      const handlers = ExceptionHandlerModel.getByExceptionId(e.id);
      for (const h of handlers) {
        const actionLabel = {
          assign: '分配负责人',
          process: '处理中更新',
          resolve: '标记解决',
          ignore: '标记忽略',
          escalate: '超时升级'
        }[h.action] || h.action;
        events.push({
          time: h.created_at,
          type: `exception_handler_${h.action}`,
          type_label: `异常${actionLabel}`,
          title: `异常处理：${actionLabel}`,
          content: `处理人：${h.handled_by}\n处理结果：${h.resolution || '（无）'}\n备注：${h.remark}`,
          operator: h.handled_by,
          meta: { handler_id: h.id, exception_id: e.id },
          icon: '🔴'
        });
      }
      if (e.escalated && e.escalated_at) {
        events.push({
          time: e.escalated_at,
          type: 'exception_escalated',
          type_label: '异常超时升级',
          title: '异常处理超时，已升级至店长',
          content: `原处理时限 ${e.deadline}，异常内容：${e.description}`,
          operator: '系统',
          icon: '🔴'
        });
      }
    }

    events.sort((a, b) => dayjs(a.time).valueOf() - dayjs(b.time).valueOf());
    events.forEach((e, idx) => { e.seq = idx + 1; });
    return { order, total_events: events.length, timeline: events };
  }
};

const NotificationModel = {
  create(data) {
    run(`
      INSERT INTO notifications (
        order_id, order_no, type, role, content, scheduled_time, status,
        channel, channel_target, send_attempts
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0)
    `, [
      data.order_id, data.order_no, data.type, data.role,
      data.content, data.scheduled_time,
      data.channel || null, data.channel_target || null
    ]);
    const row = get('SELECT MAX(id) as max_id FROM notifications');
    return this.getById(row ? row.max_id : null);
  },

  getById(id) {
    const n = get('SELECT * FROM notifications WHERE id = ?', [id]);
    if (n) n.send_logs = NotificationSendLogModel.getByNotificationId(id);
    return n;
  },

  update(id, data) {
    const fields = [];
    const values = [];
    const allowedFields = [
      'status', 'sent_time', 'read_at', 'confirmed', 'confirmed_at',
      'channel', 'channel_target', 'send_result', 'last_error',
      'auto_retry_count', 'next_retry_at', 'force_fail'
    ];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(data[field]);
      }
    }
    if (data.send_attempts !== undefined) {
      fields.push('send_attempts = send_attempts + 1');
    }
    if (fields.length === 0) return this.getById(id);
    values.push(id);
    run(`UPDATE notifications SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getById(id);
  },

  recordSendResult(id, success, resultText, channelType, channelTarget, errorMsg, triggerType) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const notif = this.getById(id);
    const attemptNo = (notif ? notif.send_attempts : 0) + 1;
    NotificationSendLogModel.create({
      notification_id: id,
      order_id: notif ? notif.order_id : null,
      order_no: notif ? notif.order_no : null,
      attempt_no: attemptNo,
      success: success ? 1 : 0,
      channel: channelType,
      channel_target: channelTarget,
      result_text: resultText,
      error_message: errorMsg || null,
      sent_at: now,
      trigger_type: triggerType || 'manual'
    });
    const updates = {
      status: success ? 'sent' : 'failed',
      sent_time: now,
      send_result: resultText,
      channel: channelType,
      channel_target: channelTarget,
      last_error: success ? null : (errorMsg || resultText),
      send_attempts: 1
    };
    if (triggerType === 'auto' && !success && notif) {
      updates.auto_retry_count = (notif.auto_retry_count || 0) + 1;
    }
    return this.update(id, updates);
  },

  getPendingNotifications(beforeTime) {
    const time = beforeTime || dayjs().format('YYYY-MM-DD HH:mm:ss');
    return all(
      `SELECT * FROM notifications WHERE status = 'pending' AND scheduled_time <= ?`,
      [time]
    );
  },

  getRetryableNotifications(beforeTime) {
    const time = beforeTime || dayjs().format('YYYY-MM-DD HH:mm:ss');
    return all(
      `SELECT * FROM notifications WHERE status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= ?`,
      [time]
    );
  },

  getByOrderId(orderId) {
    const list = all(
      `SELECT * FROM notifications WHERE order_id = ? ORDER BY scheduled_time ASC`,
      [orderId]
    );
    return list.map(n => {
      n.send_logs = NotificationSendLogModel.getByNotificationId(n.id);
      return n;
    });
  },

  getByOrderIds(orderIds) {
    if (!orderIds || orderIds.length === 0) return [];
    const placeholders = orderIds.map(() => '?').join(',');
    const list = all(
      `SELECT * FROM notifications WHERE order_id IN (${placeholders}) ORDER BY scheduled_time ASC`,
      orderIds
    );
    return list.map(n => {
      n.send_logs = NotificationSendLogModel.getByNotificationId(n.id);
      return n;
    });
  },

  list({ orderId, status, role, storeKey, page = 1, pageSize = 50 } = {}) {
    const conditions = [];
    const values = [];
    if (orderId) { conditions.push('n.order_id = ?'); values.push(orderId); }
    if (status) { conditions.push('n.status = ?'); values.push(status); }
    if (role) { conditions.push('n.role = ?'); values.push(role); }
    if (storeKey) {
      conditions.push('o.store_key = ?');
      values.push(storeKey);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const join = storeKey ? 'JOIN orders o ON o.id = n.order_id' : '';
    const countRow = get(`SELECT COUNT(*) as total FROM notifications n ${join} ${where}`, values);
    const total = countRow ? countRow.total : 0;
    const offset = (page - 1) * pageSize;
    const list = all(
      `SELECT n.* FROM notifications n ${join} ${where} ORDER BY n.scheduled_time DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );
    return { total, page, pageSize, list };
  },

  deleteByOrderId(orderId) {
    run('DELETE FROM notifications WHERE order_id = ?', [orderId]);
    run('DELETE FROM notification_send_logs WHERE order_id = ?', [orderId]);
    return { changes: 1 };
  },

  markAsRead(id) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    return this.update(id, { read_at: now });
  },

  markConfirmed(id) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    return this.update(id, { confirmed: 1, confirmed_at: now });
  }
};

const NotificationSendLogModel = {
  create(data) {
    run(`
      INSERT INTO notification_send_logs (
        notification_id, order_id, order_no, attempt_no,
        success, channel, channel_target, result_text, error_message, sent_at, trigger_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.notification_id, data.order_id, data.order_no, data.attempt_no,
      data.success || 0, data.channel || null, data.channel_target || null,
      data.result_text || null, data.error_message || null, data.sent_at,
      data.trigger_type || 'manual'
    ]);
    const row = get('SELECT MAX(id) as max_id FROM notification_send_logs');
    return this.getById(row ? row.max_id : null);
  },

  getById(id) {
    return get('SELECT * FROM notification_send_logs WHERE id = ?', [id]);
  },

  getByNotificationId(notificationId) {
    return all(
      `SELECT * FROM notification_send_logs WHERE notification_id = ? ORDER BY sent_at ASC`,
      [notificationId]
    );
  },

  getByOrderId(orderId) {
    return all(
      `SELECT * FROM notification_send_logs WHERE order_id = ? ORDER BY sent_at ASC`,
      [orderId]
    );
  }
};

const ExceptionHandlerModel = {
  create(data) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    run(`
      INSERT INTO exception_handlers (
        exception_id, order_id, order_no, action,
        status_from, status_to, resolution, remark, handled_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.exception_id, data.order_id, data.order_no, data.action,
      data.status_from || null, data.status_to || null,
      data.resolution || null, data.remark, data.handled_by, now
    ]);
    const row = get('SELECT MAX(id) as max_id FROM exception_handlers');
    return this.getById(row ? row.max_id : null);
  },

  getById(id) {
    return get('SELECT * FROM exception_handlers WHERE id = ?', [id]);
  },

  getByExceptionId(exceptionId) {
    return all(
      `SELECT * FROM exception_handlers WHERE exception_id = ? ORDER BY created_at ASC`,
      [exceptionId]
    );
  },

  getByOrderId(orderId) {
    return all(
      `SELECT * FROM exception_handlers WHERE order_id = ? ORDER BY created_at ASC`,
      [orderId]
    );
  }
};

const ExceptionModel = {
  create(data) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    run(`
      INSERT INTO exceptions (
        order_id, order_no, type, description, reporter, status,
        assignee, deadline, escalated, created_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?)
    `, [
      data.order_id, data.order_no, data.type, data.description, data.reporter,
      data.assignee || null, data.deadline || null, now
    ]);
    const row = get('SELECT MAX(id) as max_id FROM exceptions');
    return this.getById(row ? row.max_id : null);
  },

  getById(id) {
    const e = get('SELECT * FROM exceptions WHERE id = ?', [id]);
    if (!e) return null;
    e.handlers = ExceptionHandlerModel.getByExceptionId(id);
    return e;
  },

  update(id, data) {
    const fields = [];
    const values = [];
    const allowed = ['assignee', 'deadline', 'escalated', 'escalated_at'];
    for (const field of allowed) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(data[field]);
      }
    }
    if (fields.length === 0) return this.getById(id);
    values.push(id);
    run(`UPDATE exceptions SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getById(id);
  },

  handle(id, data) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const old = get('SELECT * FROM exceptions WHERE id = ?', [id]);
    const newStatus = data.status || 'resolved';
    run(`
      UPDATE exceptions SET status = ?, resolution = ?, handled_by = ?, remark = ?, handled_at = ? WHERE id = ?
    `, [newStatus, data.resolution, data.handled_by, data.remark, now, id]);
    ExceptionHandlerModel.create({
      exception_id: id,
      order_id: old.order_id,
      order_no: old.order_no,
      action: newStatus === 'resolved' ? 'resolve' : (newStatus === 'processing' ? 'process' : 'ignore'),
      status_from: old.status,
      status_to: newStatus,
      resolution: data.resolution,
      remark: data.remark,
      handled_by: data.handled_by
    });
    return this.getById(id);
  },

  assign(id, assignee, deadline, handledBy) {
    const old = get('SELECT * FROM exceptions WHERE id = ?', [id]);
    this.update(id, { assignee, deadline });
    ExceptionHandlerModel.create({
      exception_id: id,
      order_id: old.order_id,
      order_no: old.order_no,
      action: 'assign',
      status_from: old.status,
      status_to: old.status,
      resolution: `分配负责人：${assignee}，处理时限：${deadline}`,
      remark: '系统自动或手动分配',
      handled_by: handledBy || assignee || '系统'
    });
    return this.getById(id);
  },

  escalate(id) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const old = get('SELECT * FROM exceptions WHERE id = ?', [id]);
    if (!old || old.escalated) return this.getById(id);
    this.update(id, { escalated: 1, escalated_at: now });
    ExceptionHandlerModel.create({
      exception_id: id,
      order_id: old.order_id,
      order_no: old.order_no,
      action: 'escalate',
      status_from: old.status,
      status_to: old.status,
      resolution: '异常处理超时，已升级至店长',
      remark: `超过处理时限 ${old.deadline} 未处理完毕，系统自动升级`,
      handled_by: '系统'
    });
    const order = OrderModel.getById(old.order_id);
    if (order) {
      NotificationModel.create({
        order_id: old.order_id,
        order_no: old.order_no,
        type: 'exception_escalation',
        role: '店长',
        content: `【异常超时升级】\n订单号：${old.order_no}\n剧本：${order ? order.script_name : '-'}\n异常类型：${old.type}\n描述：${old.description}\n原负责人：${old.assignee || '未分配'}\n处理时限：${old.deadline}\n\n请店长介入处理。`,
        scheduled_time: now
      });
    }
    return this.getById(id);
  },

  getOverdue() {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    return all(
      `SELECT * FROM exceptions WHERE status NOT IN ('resolved', 'ignored') AND escalated = 0 AND deadline IS NOT NULL AND deadline <= ?`,
      [now]
    );
  },

  list({ orderId, status, assignee, storeKey, page = 1, pageSize = 50 } = {}) {
    const conditions = [];
    const values = [];
    const join = storeKey ? 'JOIN orders o ON o.id = e.order_id' : '';
    if (orderId) { conditions.push('e.order_id = ?'); values.push(orderId); }
    if (status) { conditions.push('e.status = ?'); values.push(status); }
    if (assignee) { conditions.push('e.assignee = ?'); values.push(assignee); }
    if (storeKey) { conditions.push('o.store_key = ?'); values.push(storeKey); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRow = get(`SELECT COUNT(*) as total FROM exceptions e ${join} ${where}`, values);
    const total = countRow ? countRow.total : 0;
    const offset = (page - 1) * pageSize;
    const list = all(
      `SELECT e.* FROM exceptions e ${join} ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );
    const withHandlers = list.map(e => ({
      ...e,
      handlers: ExceptionHandlerModel.getByExceptionId(e.id)
    }));
    return { total, page, pageSize, list: withHandlers };
  },

  getByDateAndStore(date, storeKey) {
    const startOfDay = dayjs(date).format('YYYY-MM-DD 00:00:00');
    const endOfDay = dayjs(date).format('YYYY-MM-DD 23:59:59');
    const conditions = ['e.created_at >= ?', 'e.created_at <= ?'];
    const values = [startOfDay, endOfDay];
    if (storeKey) {
      conditions.push('o.store_key = ?');
      values.push(storeKey);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const join = 'JOIN orders o ON o.id = e.order_id';
    const list = all(
      `SELECT e.* FROM exceptions e ${join} ${where} ORDER BY e.created_at ASC`,
      values
    );
    return list.map(e => ({
      ...e,
      handlers: ExceptionHandlerModel.getByExceptionId(e.id)
    }));
  },

  getByOrderId(orderId) {
    const list = all(
      `SELECT * FROM exceptions WHERE order_id = ? ORDER BY created_at DESC`,
      [orderId]
    );
    return list.map(e => ({
      ...e,
      handlers: ExceptionHandlerModel.getByExceptionId(e.id)
    }));
  },

  getByOrderIds(orderIds) {
    if (!orderIds || orderIds.length === 0) return [];
    const placeholders = orderIds.map(() => '?').join(',');
    const list = all(
      `SELECT * FROM exceptions WHERE order_id IN (${placeholders}) ORDER BY created_at ASC`,
      orderIds
    );
    return list.map(e => ({
      ...e,
      handlers: ExceptionHandlerModel.getByExceptionId(e.id)
    }));
  }
};

module.exports = {
  StoreConfigModel,
  OrderModel,
  NotificationModel,
  NotificationSendLogModel,
  ExceptionModel,
  ExceptionHandlerModel
};
