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

const initDatabase = async () => {
  const SQL = await initSqlJs();
  dbInstance = loadDatabase(SQL);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT UNIQUE NOT NULL,
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
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);

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
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);

  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_orders_game_date ON orders(game_date)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_notifications_order_id ON notifications(order_id)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_notifications_scheduled_time ON notifications(scheduled_time)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_exceptions_order_id ON exceptions(order_id)`);
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_exceptions_status ON exceptions(status)`);

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
