const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const dataDir = path.dirname(config.db.path);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let dbInstance = null;

const loadDatabase = (SQL) => {
  if (fs.existsSync(config.db.path)) {
    const fileBuffer = fs.readFileSync(config.db.path);
    return new SQL.Database(fileBuffer);
  }
  return new SQL.Database();
};

const saveDatabase = () => {
  if (dbInstance) {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(config.db.path, buffer);
  }
};

setInterval(() => {
  if (dbInstance) saveDatabase();
}, 5000);

process.on('exit', saveDatabase);
process.on('SIGINT', () => { saveDatabase(); process.exit(0); });

const columnExists = (tableName, columnName) => {
  try {
    const rows = dbInstance.exec(`PRAGMA table_info(${tableName})`);
    if (rows && rows.length > 0 && rows[0].values) {
      return rows[0].values.some(col => col[1] === columnName);
    }
  } catch (e) {}
  return false;
};

const addColumnIfNotExists = (tableName, columnDef) => {
  const colName = columnDef.split(' ')[0];
  if (!columnExists(tableName, colName)) {
    try {
      dbInstance.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef}`);
    } catch (e) {
      console.warn(`[数据库] 新增字段 ${tableName}.${colName} 跳过: ${e.message}`);
    }
  }
};

const initDatabase = async () => {
  const SQL = await initSqlJs();
  dbInstance = loadDatabase(SQL);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT UNIQUE NOT NULL,
      store_key TEXT DEFAULT 'default',
      game_date TEXT NOT NULL,
      room TEXT NOT NULL,
      script_name TEXT NOT NULL,
      player_count INTEGER NOT NULL,
      main_player_name TEXT NOT NULL,
      main_player_phone TEXT,
      dm_name TEXT NOT NULL,
      dm_phone TEXT,
      front_desk_contact TEXT NOT NULL,
      front_desk_phone TEXT,
      additional_services TEXT,
      newbie_ratio TEXT,
      status TEXT DEFAULT 'pending',
      cake_confirmed INTEGER DEFAULT 0,
      decoration_confirmed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  addColumnIfNotExists('orders', 'store_key TEXT DEFAULT "default"');

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      order_no TEXT NOT NULL,
      type TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      sent_time TEXT,
      status TEXT DEFAULT 'pending',
      read_at TEXT,
      confirmed INTEGER DEFAULT 0,
      confirmed_at TEXT,
      channel TEXT,
      channel_target TEXT,
      send_result TEXT,
      send_attempts INTEGER DEFAULT 0,
      last_error TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);

  addColumnIfNotExists('notifications', 'channel TEXT');
  addColumnIfNotExists('notifications', 'channel_target TEXT');
  addColumnIfNotExists('notifications', 'send_result TEXT');
  addColumnIfNotExists('notifications', 'send_attempts INTEGER DEFAULT 0');
  addColumnIfNotExists('notifications', 'confirmed_at TEXT');
  addColumnIfNotExists('notifications', 'last_error TEXT');

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS notification_send_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notification_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      order_no TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      success INTEGER NOT NULL DEFAULT 0,
      channel TEXT,
      channel_target TEXT,
      result_text TEXT,
      error_message TEXT,
      sent_at TEXT NOT NULL,
      FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
    );
  `);

  addColumnIfNotExists('notification_send_logs', 'error_message TEXT');
  addColumnIfNotExists('notification_send_logs', 'trigger_type TEXT DEFAULT "manual"');

  addColumnIfNotExists('notifications', 'auto_retry_count INTEGER DEFAULT 0');
  addColumnIfNotExists('notifications', 'next_retry_at TEXT');

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      order_no TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      reporter TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      resolution TEXT,
      handled_by TEXT,
      remark TEXT,
      created_at TEXT NOT NULL,
      handled_at TEXT,
      assignee TEXT,
      deadline TEXT,
      escalated INTEGER DEFAULT 0,
      escalated_at TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);

  addColumnIfNotExists('exceptions', 'assignee TEXT');
  addColumnIfNotExists('exceptions', 'deadline TEXT');
  addColumnIfNotExists('exceptions', 'escalated INTEGER DEFAULT 0');
  addColumnIfNotExists('exceptions', 'escalated_at TEXT');

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS exception_handlers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exception_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      order_no TEXT NOT NULL,
      action TEXT NOT NULL,
      status_from TEXT,
      status_to TEXT,
      resolution TEXT,
      remark TEXT NOT NULL,
      handled_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (exception_id) REFERENCES exceptions(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS store_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_key TEXT UNIQUE NOT NULL,
      store_name TEXT NOT NULL,
      address TEXT,
      front_desk_channel_type TEXT DEFAULT 'wecom',
      front_desk_channel_config TEXT,
      dm_channel_type TEXT DEFAULT 'wecom',
      dm_channel_config TEXT,
      customer_channel_type TEXT DEFAULT 'sms',
      customer_channel_config TEXT,
      manager_phone TEXT,
      manager_name TEXT,
      default_assignee TEXT,
      exception_deadline_minutes INTEGER DEFAULT 60,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_orders_game_date ON orders(game_date)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_notifications_order_id ON notifications(order_id)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_notifications_scheduled_time ON notifications(scheduled_time)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_exceptions_order_id ON exceptions(order_id)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_exceptions_status ON exceptions(status)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_exceptions_deadline ON exceptions(deadline)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_exception_handlers_exception_id ON exception_handlers(exception_id)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_exception_handlers_order_id ON exception_handlers(order_id)`);
  addColumnIfNotExists('store_configs', 'retry_config TEXT');

  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_store_configs_store_key ON store_configs(store_key)`);

  const defaultConfig = dbInstance.exec("SELECT COUNT(*) as c FROM store_configs WHERE store_key = 'default'");
  if (!defaultConfig || !defaultConfig.length || !defaultConfig[0].values || !defaultConfig[0].values.length || defaultConfig[0].values[0][0] === 0) {
    const dayjs = require('dayjs');
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const frontDeskConfig = JSON.stringify({ webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=FRONT-DESK-KEY-EXAMPLE' });
    const dmConfig = JSON.stringify({ webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=DM-KEY-EXAMPLE' });
    const customerConfig = JSON.stringify({ mock: true, gateway: 'sms_gateway_example', sign: '【XX剧本杀】' });
    const stmt = dbInstance.prepare(`
      INSERT INTO store_configs (
        store_key, store_name, address,
        front_desk_channel_type, front_desk_channel_config,
        dm_channel_type, dm_channel_config,
        customer_channel_type, customer_channel_config,
        manager_phone, manager_name, default_assignee, exception_deadline_minutes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.bind([
      'default', '旗舰店示例', 'XX市XX区XX路XX号3层',
      'wecom', frontDeskConfig,
      'wecom', dmConfig,
      'sms', customerConfig,
      '13800000000', '店长老刘', '前台小王', 60,
      now, now
    ]);
    stmt.step();
    stmt.free();
    console.log('[数据库] 已插入默认门店配置');
  }

  saveDatabase();
  console.log('[数据库] 初始化完成');
  return dbInstance;
};

const getDb = () => dbInstance;

const run = (sql, params = []) => {
  const stmt = dbInstance.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  saveDatabase();
  const idResult = dbInstance.exec('SELECT last_insert_rowid() as id');
  if (idResult && idResult.length > 0 && idResult[0].values && idResult[0].values.length > 0) {
    return idResult[0].values[0][0];
  }
  return null;
};

const get = (sql, params = []) => {
  const stmt = dbInstance.prepare(sql);
  stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
};

const all = (sql, params = []) => {
  const stmt = dbInstance.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
};

module.exports = {
  initDatabase,
  getDb,
  run,
  get,
  all,
  saveDatabase
};
