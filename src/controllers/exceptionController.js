const dayjs = require('dayjs');
const { ExceptionModel, OrderModel } = require('../models');

const EXCEPTION_TYPES = [
  'cake_not_arrived',
  'player_count_changed',
  'main_player_time_changed',
  'decoration_issue',
  'dm_unavailable',
  'other'
];

const EXCEPTION_TYPE_LABELS = {
  cake_not_arrived: '蛋糕未到货',
  player_count_changed: '玩家人数变动',
  main_player_time_changed: '主角临时改时间',
  decoration_issue: '布置物料问题',
  dm_unavailable: 'DM临时无法到场',
  other: '其他问题'
};

module.exports = {
  reportException: (req, res) => {
    const { order_id, type, description, reporter } = req.body;
    if (!order_id || !type || !description || !reporter) {
      return res.status(400).json({ code: 400, message: 'order_id, type, description, reporter 为必填项' });
    }
    if (!EXCEPTION_TYPES.includes(type)) {
      return res.status(400).json({
        code: 400,
        message: `type 必须是以下之一: ${EXCEPTION_TYPES.join(', ')}`,
        labels: EXCEPTION_TYPE_LABELS
      });
    }
    const order = OrderModel.getById(order_id);
    if (!order) {
      return res.status(404).json({ code: 404, message: '订单不存在' });
    }
    try {
      const exception = ExceptionModel.create({
        order_id,
        order_no: order.order_no,
        type,
        description,
        reporter
      });
      console.log(`\n[异常上报] 订单号: ${order.order_no} | 类型: ${EXCEPTION_TYPE_LABELS[type]}`);
      console.log(`  上报人: ${reporter}`);
      console.log(`  描述: ${description}\n`);
      res.json({
        code: 200,
        message: '异常上报成功',
        data: { ...exception, type_label: EXCEPTION_TYPE_LABELS[exception.type] }
      });
    } catch (err) {
      res.status(500).json({ code: 500, message: err.message });
    }
  },

  handleException: (req, res) => {
    const { id } = req.params;
    const { status, resolution, handled_by, remark } = req.body;
    const exception = ExceptionModel.getById(id);
    if (!exception) {
      return res.status(404).json({ code: 404, message: '异常记录不存在' });
    }
    if (status && !['resolved', 'processing', 'ignored'].includes(status)) {
      return res.status(400).json({ code: 400, message: 'status 只能是 resolved, processing, ignored' });
    }
    if (!handled_by) {
      return res.status(400).json({ code: 400, message: 'handled_by 处理人为必填项' });
    }
    if (status === 'resolved' && !resolution) {
      return res.status(400).json({ code: 400, message: '标记为 resolved 时必须填写 resolution 处理结果' });
    }
    try {
      const handled = ExceptionModel.handle(id, {
        status: status || 'resolved',
        resolution,
        handled_by,
        remark
      });
      console.log(`\n[异常处理] 异常ID: ${id} | 新状态: ${status || 'resolved'}`);
      console.log(`  处理人: ${handled_by}`);
      console.log(`  处理结果: ${resolution || '无'}`);
      console.log(`  备注: ${remark || '无'}\n`);
      res.json({
        code: 200,
        message: '处理成功',
        data: { ...handled, type_label: EXCEPTION_TYPE_LABELS[handled.type] }
      });
    } catch (err) {
      res.status(500).json({ code: 500, message: err.message });
    }
  },

  getException: (req, res) => {
    const { id } = req.params;
    const exception = ExceptionModel.getById(id);
    if (!exception) {
      return res.status(404).json({ code: 404, message: '异常记录不存在' });
    }
    res.json({
      code: 200,
      data: { ...exception, type_label: EXCEPTION_TYPE_LABELS[exception.type] }
    });
  },

  listExceptions: (req, res) => {
    const { orderId, status, page, pageSize } = req.query;
    const result = ExceptionModel.list({
      orderId: orderId ? Number(orderId) : undefined,
      status,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50
    });
    result.list = result.list.map(e => ({ ...e, type_label: EXCEPTION_TYPE_LABELS[e.type] }));
    res.json({ code: 200, data: result });
  },

  getTypes: (req, res) => {
    res.json({
      code: 200,
      data: EXCEPTION_TYPES.map(t => ({ value: t, label: EXCEPTION_TYPE_LABELS[t] }))
    });
  }
};
