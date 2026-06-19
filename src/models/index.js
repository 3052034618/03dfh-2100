const { run, get, all } = require('../db');
const dayjs = require('dayjs');
const { v4: uuidv4 } = require('uuid');

const generateOrderNo = () => {
  return 'BR' + dayjs().format('YYYYMMDDHHmmss') + uuidv4().slice(0, 4).toUpperCase();
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
    if (status) {
      conditions.push('status = ?');
      values.push(status);
    }
    if (startDate) {
      conditions.push('game_date >= ?');
      values.push(startDate);
    }
    if (endDate) {
      conditions.push('game_date <= ?');
      values.push(endDate);
    }
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
  }
};

const NotificationModel = {
  create(data) {
    run(`
      INSERT INTO notifications (
        order_id, order_no, type, role, content, scheduled_time, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `, [
      data.order_id, data.order_no, data.type, data.role,
      data.content, data.scheduled_time
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
    const allowedFields = ['status', 'sent_time', 'read_at', 'confirmed'];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(data[field]);
      }
    }
    if (fields.length === 0) return this.getById(id);
    values.push(id);
    run(`UPDATE notifications SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getById(id);
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
    if (orderId) {
      conditions.push('order_id = ?');
      values.push(orderId);
    }
    if (status) {
      conditions.push('status = ?');
      values.push(status);
    }
    if (role) {
      conditions.push('role = ?');
      values.push(role);
    }
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

const ExceptionModel = {
  create(data) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    run(`
      INSERT INTO exceptions (
        order_id, order_no, type, description, reporter, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `, [
      data.order_id, data.order_no, data.type, data.description, data.reporter, now
    ]);
    const row = get('SELECT MAX(id) as max_id FROM exceptions');
    return this.getById(row ? row.max_id : null);
  },

  getById(id) {
    return get('SELECT * FROM exceptions WHERE id = ?', [id]);
  },

  handle(id, data) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    run(`
      UPDATE exceptions SET status = ?, resolution = ?, handled_by = ?, remark = ?, handled_at = ? WHERE id = ?
    `, [data.status || 'resolved', data.resolution || null, data.handled_by, data.remark || null, now, id]);
    return this.getById(id);
  },

  list({ orderId, status, page = 1, pageSize = 50 } = {}) {
    const conditions = [];
    const values = [];
    if (orderId) {
      conditions.push('order_id = ?');
      values.push(orderId);
    }
    if (status) {
      conditions.push('status = ?');
      values.push(status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRow = get(`SELECT COUNT(*) as total FROM exceptions ${where}`, values);
    const total = countRow ? countRow.total : 0;
    const offset = (page - 1) * pageSize;
    const list = all(
      `SELECT * FROM exceptions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );
    return { total, page, pageSize, list };
  },

  getByOrderId(orderId) {
    return all(
      `SELECT * FROM exceptions WHERE order_id = ? ORDER BY created_at DESC`,
      [orderId]
    );
  }
};

module.exports = {
  OrderModel,
  NotificationModel,
  ExceptionModel
};
