const dayjs = require('dayjs');
const { ExceptionModel, OrderModel, StoreConfigModel, ExceptionHandlerModel } = require('../models');

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

const RESOLUTION_OPTIONS = [
  { value: 'contact_backup', label: '联系备用方案' },
  { value: 'negotiate_customer', label: '与客户协商改期/退款' },
  { value: 'internal_transfer', label: '内部协调解决' },
  { value: 'emergency_purchase', label: '紧急采购替换' },
  { value: 'delayed_start', label: '推迟开场时间' },
  { value: 'other', label: '其他处理方式' }
];

const EXCEPTION_DEADLINE_MAP = {
  cake_not_arrived: 30,
  player_count_changed: 15,
  main_player_time_changed: 15,
  decoration_issue: 45,
  dm_unavailable: 20,
  other: 60
};

module.exports = {
  getTypes: (req, res) => {
    res.json({
      code: 200,
      data: {
        types: EXCEPTION_TYPES.map(t => ({ value: t, label: EXCEPTION_TYPE_LABELS[t] })),
        resolutions: RESOLUTION_OPTIONS,
        default_deadline_minutes: EXCEPTION_DEADLINE_MAP
      }
    });
  },

  reportException: (req, res) => {
    const { order_id, type, description, reporter, assignee, deadline_minutes } = req.body;
    if (!order_id || !type || !description || !reporter) {
      return res.status(400).json({
        code: 400,
        message: 'order_id, type, description, reporter 为必填项'
      });
    }
    if (!EXCEPTION_TYPES.includes(type)) {
      return res.status(400).json({
        code: 400,
        message: `type 必须是以下之一: ${EXCEPTION_TYPES.join(', ')}`,
        labels: EXCEPTION_TYPE_LABELS
      });
    }
    const order = OrderModel.getById(order_id);
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
    const finalAssignee = assignee || StoreConfigModel.getDefaultAssignee('default');
    const finalDeadlineMinutes = deadline_minutes
      ? Number(deadline_minutes)
      : (EXCEPTION_DEADLINE_MAP[type] || StoreConfigModel.getDeadlineMinutes('default'));
    const deadline = dayjs().add(finalDeadlineMinutes, 'minute').format('YYYY-MM-DD HH:mm:ss');
    try {
      const exception = ExceptionModel.create({
        order_id,
        order_no: order.order_no,
        type,
        description,
        reporter,
        assignee: finalAssignee,
        deadline
      });
      if (finalAssignee) {
        ExceptionHandlerModel.create({
          exception_id: exception.id,
          order_id,
          order_no: order.order_no,
          action: 'assign',
          status_from: 'pending',
          status_to: 'pending',
          resolution: `自动分配负责人：${finalAssignee}，处理时限：${finalDeadlineMinutes} 分钟（${deadline}）`,
          remark: `上报时系统根据异常类型 ${EXCEPTION_TYPE_LABELS[type]} 自动分配`,
          handled_by: '系统'
        });
        const refreshed = ExceptionModel.getById(exception.id);
        exception.handlers = refreshed ? refreshed.handlers : [ExceptionHandlerModel.getByExceptionId(exception.id)];
      }
      console.log(`\n[异常上报] 订单号: ${order.order_no} | 类型: ${EXCEPTION_TYPE_LABELS[type]}`);
      console.log(`  上报人: ${reporter}`);
      console.log(`  描述: ${description}`);
      console.log(`  负责人: ${finalAssignee || '未分配'} | 处理时限: ${deadline}\n`);
      res.json({
        code: 200,
        message: '异常上报成功',
        data: {
          ...exception,
          type_label: EXCEPTION_TYPE_LABELS[exception.type],
          deadline_minutes: finalDeadlineMinutes,
          handlers: exception.handlers || ExceptionHandlerModel.getByExceptionId(exception.id)
        }
      });
    } catch (err) {
      res.status(500).json({ code: 500, message: err.message });
    }
  },

  assignException: (req, res) => {
    const { id } = req.params;
    const { assignee, deadline_minutes, handled_by } = req.body;
    const exception = ExceptionModel.getById(id);
    if (!exception) return res.status(404).json({ code: 404, message: '异常记录不存在' });
    if (!assignee) return res.status(400).json({ code: 400, message: 'assignee 负责人为必填项' });
    if (!handled_by) return res.status(400).json({ code: 400, message: 'handled_by 操作人为必填项' });
    const minutes = deadline_minutes ? Number(deadline_minutes) : StoreConfigModel.getDeadlineMinutes('default');
    const deadline = dayjs().add(minutes, 'minute').format('YYYY-MM-DD HH:mm:ss');
    const updated = ExceptionModel.assign(id, assignee, deadline, handled_by);
    res.json({
      code: 200,
      message: '分配成功',
      data: { ...updated, type_label: EXCEPTION_TYPE_LABELS[updated.type] }
    });
  },

  handleException: (req, res) => {
    const { id } = req.params;
    const { status, resolution, handled_by, remark } = req.body;
    const exception = ExceptionModel.getById(id);
    if (!exception) return res.status(404).json({ code: 404, message: '异常记录不存在' });
    if (exception.status === 'resolved' || exception.status === 'ignored') {
      return res.status(400).json({
        code: 400,
        message: `该异常已标记为 ${exception.status}，不可重复处理。如需要请先更新为 processing。`
      });
    }
    const validStatuses = ['processing', 'resolved', 'ignored'];
    const finalStatus = status || 'resolved';
    if (!validStatuses.includes(finalStatus)) {
      return res.status(400).json({
        code: 400,
        message: `status 只能是: ${validStatuses.join(', ')}`
      });
    }
    if (!handled_by || !handled_by.trim()) {
      return res.status(400).json({
        code: 400,
        message: 'handled_by 处理人为必填项，请填写处理人姓名'
      });
    }
    if (!resolution || !resolution.trim()) {
      return res.status(400).json({
        code: 400,
        message: 'resolution 处理结果为必填项，请选择或填写处理方式。可选值参考 GET /api/exceptions/types 中的 resolutions 列表'
      });
    }
    if (!remark || !remark.trim()) {
      return res.status(400).json({
        code: 400,
        message: 'remark 备注为必填项，请填写处理过程细节、沟通记录或补充说明'
      });
    }
    try {
      const handled = ExceptionModel.handle(id, {
        status: finalStatus,
        resolution,
        handled_by,
        remark
      });
      console.log(`\n[异常处理] 异常ID: ${id} | 新状态: ${finalStatus}`);
      console.log(`  处理人: ${handled_by}`);
      console.log(`  处理结果: ${resolution}`);
      console.log(`  备注: ${remark}\n`);
      res.json({
        code: 200,
        message: finalStatus === 'resolved' ? '异常已标记解决' : (finalStatus === 'processing' ? '已更新处理进度' : '已标记忽略'),
        data: {
          ...handled,
          type_label: EXCEPTION_TYPE_LABELS[handled.type],
          handlers: ExceptionHandlerModel.getByExceptionId(id)
        }
      });
    } catch (err) {
      res.status(500).json({ code: 500, message: err.message });
    }
  },

  getException: (req, res) => {
    const { id } = req.params;
    const exception = ExceptionModel.getById(id);
    if (!exception) return res.status(404).json({ code: 404, message: '异常记录不存在' });
    const overdue = exception.deadline && dayjs().isAfter(dayjs(exception.deadline))
      && !(exception.status === 'resolved' || exception.status === 'ignored');
    res.json({
      code: 200,
      data: {
        ...exception,
        type_label: EXCEPTION_TYPE_LABELS[exception.type],
        is_overdue: overdue,
        handlers: exception.handlers || []
      }
    });
  },

  listExceptions: (req, res) => {
    const { orderId, status, assignee, page, pageSize } = req.query;
    const raw = ExceptionModel.list({
      orderId: orderId ? Number(orderId) : undefined,
      status,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50
    });
    let list = raw.list;
    if (assignee) {
      list = list.filter(e => e.assignee === assignee);
    }
    list = list.map(e => ({
      ...e,
      type_label: EXCEPTION_TYPE_LABELS[e.type],
      is_overdue: e.deadline && dayjs().isAfter(dayjs(e.deadline))
        && !(e.status === 'resolved' || e.status === 'ignored')
    }));
    res.json({
      code: 200,
      data: {
        total: list.length,
        page: raw.page,
        pageSize: raw.pageSize,
        list
      }
    });
  }
};
