const express = require('express');
const config = require('./config');
const { initDatabase } = require('./db');
const notificationScheduler = require('./scheduler/notificationScheduler');

const ordersRouter = require('./routes/orders');
const notificationsRouter = require('./routes/notifications');
const exceptionsRouter = require('./routes/exceptions');
const storeConfigsRouter = require('./routes/storeConfigs');

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
    version: '2.2.0',
    endpoints: {
      orders: '/api/orders',
      notifications: '/api/notifications',
      exceptions: '/api/exceptions',
      store_configs: '/api/store-configs'
    },
    api_documentation: {
      store_configs: {
        'GET    /api/store-configs': '门店配置列表',
        'GET    /api/store-configs/:key': '查询门店配置',
        'POST   /api/store-configs': '新增门店配置（支持 retry_config 重试策略）',
        'PUT    /api/store-configs/:key': '更新门店配置（渠道、负责人、时限、重试策略）',
        'DELETE /api/store-configs/:key': '删除门店配置',
        'GET    /api/store-configs/channels': '支持的通知渠道列表',
        'GET    /api/store-configs/:key/preview?role=前台|DM|顾客|店长': '预览某角色的渠道配置',
        'GET    /api/store-configs/:key/dashboard?date=YYYY-MM-DD': '门店当日运营看板（严格按门店+日期隔离）',
        'GET    /api/store-configs/:key/daily-report?date=YYYY-MM-DD': '店长复盘日报（触达/确认耗时/异常耗时/风险订单）'
      },
      orders: {
        'POST   /api/orders': '创建生日包场订单（支持 store_key，自动按门店渠道生成3条提醒）',
        'GET    /api/orders': '订单列表（支持 storeKey/status/startDate/endDate/page/pageSize 参数）',
        'GET    /api/orders/:id': '查询订单详情（含通知+发送日志+异常+处理历史）',
        'GET    /api/orders/:id/timeline': '完整服务时间线（订单+提醒发送/已读/确认+异常+处理，真实时间）',
        'PUT    /api/orders/:id': '更新订单信息（改开场时间自动重算提醒）',
        'DELETE /api/orders/:id': '删除订单',
        'POST   /api/orders/:id/confirm': '确认物料（body: { item: "cake"|"decoration", confirmed: true|false }）'
      },
      notifications: {
        'GET    /api/notifications': '通知列表（支持 storeKey/orderId/status/role/page/pageSize 参数）',
        'GET    /api/notifications/:id': '查询通知详情（含 send_logs 发送日志、send_attempts、last_error）',
        'POST   /api/notifications/:id/read': '标记为已读',
        'POST   /api/notifications/:id/confirm': '确认通知（记录 confirmed_at 真实时间），前台可同步确认物料',
        'POST   /api/notifications/:id/send': '手动立即发送通知（按门店渠道匹配，返回发送结果）',
        'POST   /api/notifications/:id/retry': '手动重试发送（失败通知专用，每次结果写入 send_logs）'
      },
      exceptions: {
        'GET    /api/exceptions/types': '获取异常类型、处理选项、默认处理时限',
        'POST   /api/exceptions': '上报异常（自动按订单所属门店分配负责人和时限）',
        'GET    /api/exceptions': '异常列表（支持 storeKey/orderId/status/assignee/page/pageSize 参数，含 is_overdue 标记）',
        'GET    /api/exceptions/:id': '查询异常详情（含处理历史、负责人、时限、超时标记）',
        'POST   /api/exceptions/:id/assign': '重新分配负责人及处理时限（按订单门店取时限）',
        'POST   /api/exceptions/:id/handle': '处理异常（resolution 处理结果 + remark 备注均为必填）'
      }
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ code: 200, status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/_debug/trigger-escalation', async (req, res) => {
  try {
    const result = await notificationScheduler.tick();
    res.json({
      code: 200,
      message: '手动触发调度扫描完成',
      result: result || { info: 'tick executed' }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: '扫描失败：' + err.message });
  }
});

app.use('/api/orders', ordersRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/exceptions', exceptionsRouter);
app.use('/api/store-configs', storeConfigsRouter);

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
    console.log('\n' + '='.repeat(65));
    console.log('  剧本杀商家生日包场通知服务 v2.2');
    console.log(`  服务地址: http://localhost:${config.port}`);
    console.log(`  API 文档: http://localhost:${config.port}/`);
    console.log('='.repeat(65));
    console.log('  核心能力:');
    console.log('    • 多门店通知渠道配置（企业微信/短信/钉钉）+ 重试策略');
    console.log('    • 订单创建自动匹配渠道生成3个节点提醒');
    console.log('    • 通知发送失败自动重试 + 达上限升级店长');
    console.log('    • 异常自动分配负责人 + 按订单门店走时限');
    console.log('    • 异常超时自动升级至店长（生成升级提醒）');
    console.log('    • 门店运营看板（严格门店+日期隔离）');
    console.log('    • 店长复盘日报（触达率/确认耗时/异常耗时/风险订单）');
    console.log('    • 时间线区分自动重试/手动重试');
    console.log('='.repeat(65) + '\n');
    notificationScheduler.start();
  });
};

startServer().catch(err => {
  console.error('服务启动失败:', err);
  process.exit(1);
});
