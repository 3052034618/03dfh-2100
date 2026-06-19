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
      customer_channel_config: tryParseJSON(row.customer_channel_config)
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
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      'front_desk_channel_config', 'dm_channel_config', 'customer_channel_config'
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
  }
};

const OrderModel = {
  create(data) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const orderNo = generateOrderNo();
    run(`
      INSERT INTO orders (
        order_no, game_date, room, script_name, player_count,
        main_player_name, main_player_phone, dm_name, dm_phone,
        front_desk_contact, front_desk_phone, additional_services,
        newbie_ratio, status, cake_confirmed, decoration_confirmed,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      orderNo, data.game_date, data.room, data.script_name, data.player_count,
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
      'game_date', 'room', 'script_name', 'player_count',
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

  list({ status, startDate, endDate, page = 1, pageSize = 20 } = {}) {
    const conditions = [];
    const values = [];
    if (status) { conditions.push('status = ?'); values.push(status); }
    if (startDate) { conditions.push('game_date >= ?'); values.push(startDate); }
    if (endDate) { conditions.push('game_date <= ?'); values.push(endDate); }
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
      operator: order.front_desk_contact
    });

    events.push({
      time: order.updated_at,
      type: 'order_updated',
      type_label: '订单更新',
      title: '订单信息更新',
      content: `玩家 ${order.player_count} 人，主角 ${order.main_player_name}，DM：${order.dm_name}`,
      operator: order.front_desk_contact
    });

    const notifications = NotificationModel.getByOrderId(id);
    for (const n of notifications) {
      const typeLabel = {
        day_before: '开场前一天提醒',
        three_hours_before: '开场前3小时提醒',
        one_hour_before: '开场前1小时提醒',
        exception_escalation: '异常超时升级提醒'
      }[n.type] || n.type;
      const channelLabel = { wecom: '企业微信', sms: '短信', console: '控制台' }[n.channel] || n.channel;

      events.push({
        time: n.scheduled_time,
        type: 'notification_scheduled',
        type_label: `${typeLabel}-计划`,
        title: `${typeLabel}（${n.role}）`,
        content: `计划通过 ${channelLabel || '默认渠道'} 发送`,
        operator: '系统'
      });

      if (n.sent_time) {
        events.push({
          time: n.sent_time,
          type: 'notification_sent',
          type_label: `${typeLabel}-已发送`,
          title: `${typeLabel} 已发送（${n.role}）`,
          content: `通过 ${channelLabel || n.channel} 发送，发送结果：${n.send_result || '成功'}`,
          operator: '系统'
        });
      }
      if (n.read_at) {
        events.push({
          time: n.read_at,
          type: 'notification_read',
          type_label: `${typeLabel}-已读`,
          title: `${n.role} 已读提醒`,
          content: n.send_result || '已确认接收',
          operator: n.role
        });
      }
      if (n.confirmed) {
        events.push({
          time: n.read_at || n.sent_time || n.scheduled_time,
          type: 'notification_confirmed',
          type_label: `${typeLabel}-已确认`,
          title: `${n.role} 确认了提醒`,
          content: n.role === '前台' ? '蛋糕和布置物料已核对确认' : '已确认收到并按要求准备',
          operator: n.role
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
        meta: { exception_id: e.id, assignee: e.assignee, deadline: e.deadline }
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
          meta: { handler_id: h.id, exception_id: e.id }
        });
      }
      if (e.escalated && e.escalated_at) {
        events.push({
          time: e.escalated_at,
          type: 'exception_escalated',
          type_label: '异常超时升级',
          title: '异常处理超时，已升级至店长',
          content: `原处理时限 ${e.deadline}，异常内容：${e.description}`,
          operator: '系统'
        });
      }
    }

    events.sort((a, b) => dayjs(a.time).valueOf() - dayjs(b.time).valueOf());
    events.forEach((e, idx) => { e.seq = idx + 1; });
    return { order, timeline: events };
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
    return get('SELECT * FROM notifications WHERE id = ?', [id]);
  },

  update(id, data) {
    const fields = [];
    const values = [];
    const allowedFields = [
      'status', 'sent_time', 'read_at', 'confirmed',
      'channel', 'channel_target', 'send_result'
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

  recordSendResult(id, success, resultText, channelType, channelTarget) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    return this.update(id, {
      status: success ? 'sent' : 'failed',
      sent_time: now,
      send_result: resultText,
      channel: channelType,
      channel_target: channelTarget,
      send_attempts: 1
    });
  },

  getPendingNotifications(beforeTime) {
    const time = beforeTime || dayjs().format('YYYY-MM-DD HH:mm:ss');
    return all(
      `SELECT * FROM notifications WHERE status = 'pending' AND scheduled_time <= ?`,
      [time]
    );
  },

  getByOrderId(orderId) {
    return all(
      `SELECT * FROM notifications WHERE order_id = ? ORDER BY scheduled_time ASC`,
      [orderId]
    );
  },

  list({ orderId, status, role, page = 1, pageSize = 50 } = {}) {
    const conditions = [];
    const values = [];
    if (orderId) { conditions.push('order_id = ?'); values.push(orderId); }
    if (status) { conditions.push('status = ?'); values.push(status); }
    if (role) { conditions.push('role = ?'); values.push(role); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRow = get(`SELECT COUNT(*) as total FROM notifications ${where}`, values);
    const total = countRow ? countRow.total : 0;
    const offset = (page - 1) * pageSize;
    const list = all(
      `SELECT * FROM notifications ${where} ORDER BY scheduled_time DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );
    return { total, page, pageSize, list };
  },

  deleteByOrderId(orderId) {
    run('DELETE FROM notifications WHERE order_id = ?', [orderId]);
    return { changes: 1 };
  },

  markConfirmed(id) {
    return this.update(id, { confirmed: 1 });
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

  list({ orderId, status, page = 1, pageSize = 50 } = {}) {
    const conditions = [];
    const values = [];
    if (orderId) { conditions.push('order_id = ?'); values.push(orderId); }
    if (status) { conditions.push('status = ?'); values.push(status); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRow = get(`SELECT COUNT(*) as total FROM exceptions ${where}`, values);
    const total = countRow ? countRow.total : 0;
    const offset = (page - 1) * pageSize;
    const list = all(
      `SELECT * FROM exceptions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );
    const withHandlers = list.map(e => ({
      ...e,
      handlers: ExceptionHandlerModel.getByExceptionId(e.id)
    }));
    return { total, page, pageSize, list: withHandlers };
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
  }
};

module.exports = {
  StoreConfigModel,
  OrderModel,
  NotificationModel,
  ExceptionModel,
  ExceptionHandlerModel
};
