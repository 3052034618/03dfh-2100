const express = require('express');
const config = require('./config');
const { initDatabase } = require('./db');
const notificationScheduler = require('./scheduler/notificationScheduler');

const ordersRouter = require('./routes/orders');
const notificationsRouter = require('./routes/notifications');
const exceptionsRouter = require('./routes/exceptions');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get('/', (req, res) => {
  res.json({
    code: 200,
    message: '剧本杀生日包场通知服务',
    version: '1.0.0',
    endpoints: {
      orders: '/api/orders',
      notifications: '/api/notifications',
      exceptions: '/api/exceptions'
    },
    api_documentation: {
      orders: {
        'POST   /api/orders': '创建生日包场订单',
        'GET    /api/orders': '订单列表（支持 status/startDate/endDate/page/pageSize 参数）',
        'GET    /api/orders/:id': '查询订单详情（含通知和异常）',
        'PUT    /api/orders/:id': '更新订单信息',
        'DELETE /api/orders/:id': '删除订单',
        'POST   /api/orders/:id/confirm': '确认物料（body: { item: "cake"|"decoration", confirmed: true|false }）'
      },
      notifications: {
        'GET    /api/notifications': '通知列表（支持 orderId/status/role/page/pageSize 参数）',
        'GET    /api/notifications/:id': '查询通知详情',
        'POST   /api/notifications/:id/read': '标记为已读',
        'POST   /api/notifications/:id/confirm': '确认通知并可选物料确认',
        'POST   /api/notifications/:id/send': '手动立即发送通知'
      },
      exceptions: {
        'GET    /api/exceptions/types': '获取异常类型列表',
        'POST   /api/exceptions': '上报异常',
        'GET    /api/exceptions': '异常列表（支持 orderId/status/page/pageSize 参数）',
        'GET    /api/exceptions/:id': '查询异常详情',
        'POST   /api/exceptions/:id/handle': '处理异常（填写处理结果、处理人、备注）'
      }
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ code: 200, status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/orders', ordersRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/exceptions', exceptionsRouter);

app.use((req, res) => {
  res.status(404).json({ code: 404, message: '接口不存在' });
});

app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ code: 500, message: err.message || '服务器内部错误' });
});

const startServer = async () => {
  await initDatabase();
  app.listen(config.port, () => {
    console.log('\n' + '='.repeat(60));
    console.log('  剧本杀商家生日包场通知服务');
    console.log(`  服务地址: http://localhost:${config.port}`);
    console.log(`  API 文档: http://localhost:${config.port}/`);
    console.log('='.repeat(60) + '\n');
    notificationScheduler.start();
  });
};

startServer().catch(err => {
  console.error('服务启动失败:', err);
  process.exit(1);
});
