const dayjs = require('dayjs');
const { StoreConfigModel, OrderModel, NotificationModel, ExceptionModel } = require('../models');

const CHANNEL_LABELS = {
  wecom: '企业微信群机器人',
  sms: '短信接口',
  dingtalk: '钉钉群机器人',
  console: '控制台输出'
};

const UNCONFIRMED_HOURS_THRESHOLD = 2;

const calcOverdueExceptions = (exceptions, now) => {
  const list = [];
  for (const e of exceptions) {
    if (!e.deadline) continue;
    const isUnresolvedOverdue = e.status !== 'resolved' && e.status !== 'ignored' && e.deadline <= now;
    const isResolvedLate = (e.status === 'resolved' || e.status === 'ignored')
      && e.handled_at && e.handled_at > e.deadline;
    if (isUnresolvedOverdue || isResolvedLate) {
      list.push({ ...e, _overdue_type: isUnresolvedOverdue ? 'unresolved' : 'resolved_late' });
    }
  }
  return list;
};

const calcRiskLevel = (order, orderNotifs, orderExcs, now) => {
  const reasons = [];
  let score = 0;

  const failedNotifs = orderNotifs.filter(n => n.status === 'failed');
  if (failedNotifs.length >= 2) {
    reasons.push('多条通知发送失败');
    score += 30;
  } else if (failedNotifs.length >= 1) {
    reasons.push('通知发送失败');
    score += 20;
  }

  const longUnconfirmed = orderNotifs.filter(n => {
    if (n.status !== 'sent' || n.confirmed === 1 || !n.sent_time) return false;
    return dayjs(now).diff(dayjs(n.sent_time), 'hour') >= UNCONFIRMED_HOURS_THRESHOLD;
  });
  if (longUnconfirmed.length >= 1) {
    reasons.push(`通知长时间未确认(>=${UNCONFIRMED_HOURS_THRESHOLD}小时)`);
    score += 15;
  }

  const overdue = calcOverdueExceptions(orderExcs, now);
  const unresolvedOverdue = overdue.filter(o => o._overdue_type === 'unresolved');
  const resolvedLate = overdue.filter(o => o._overdue_type === 'resolved_late');
  if (unresolvedOverdue.length >= 1) {
    reasons.push('异常超时未处理');
    score += 30;
  } else if (resolvedLate.length >= 1) {
    reasons.push('异常处理超时(已处理)');
    score += 15;
  }

  const activeExcs = orderExcs.filter(e => e.status !== 'resolved' && e.status !== 'ignored');
  if (activeExcs.length >= 2) {
    reasons.push('多异常并发');
    score += 15;
  }

  let level = 'low';
  let levelLabel = '低风险';
  if (score >= 30) { level = 'high'; levelLabel = '高风险'; }
  else if (score >= 15) { level = 'medium'; levelLabel = '中风险'; }

  return { level, level_label: levelLabel, score, reasons };
};

const summarizeDay = (date, storeKey) => {
  const orders = OrderModel.getByDateAndStore(date, storeKey);
  const orderIds = orders.map(o => o.id);
  if (orderIds.length === 0) {
    return {
      date,
      order_count: 0,
      notification_stats: { total: 0, sent: 0, failed: 0, confirmed: 0, reach_rate: '0%', confirm_rate: '0%', avg_confirmation_seconds: null, avg_confirmation_time: null },
      exception_stats: { total: 0, resolved: 0, overdue: 0, resolved_late: 0, resolve_rate: '0%', avg_handling_seconds: null, avg_handling_time: null },
      risk_stats: { high: 0, medium: 0, low: 0 },
      orders: [],
      risk_orders: []
    };
  }

  const allNotifs = NotificationModel.getByOrderIds(orderIds);
  const totalNotifications = allNotifs.length;
  const sentNotifications = allNotifs.filter(n => n.status === 'sent').length;
  const failedNotifications = allNotifs.filter(n => n.status === 'failed').length;
  const confirmedNotifications = allNotifs.filter(n => n.confirmed === 1).length;
  const confirmationTimes = [];
  for (const n of allNotifs) {
    if (n.sent_time && n.confirmed_at) {
      const diff = dayjs(n.confirmed_at).diff(dayjs(n.sent_time), 'second');
      if (diff >= 0) confirmationTimes.push(diff);
    }
  }

  const allExcs = ExceptionModel.getByOrderIds(orderIds);
  const totalExceptions = allExcs.length;
  const resolvedExceptions = allExcs.filter(e => e.status === 'resolved' || e.status === 'ignored').length;
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const overdueList = calcOverdueExceptions(allExcs, now);
  const overdueUnresolved = overdueList.filter(o => o._overdue_type === 'unresolved').length;
  const overdueResolvedLate = overdueList.filter(o => o._overdue_type === 'resolved_late').length;
  const exceptionHandlingTimes = [];
  for (const e of allExcs) {
    if (e.handled_at && e.created_at) {
      const diff = dayjs(e.handled_at).diff(dayjs(e.created_at), 'second');
      if (diff >= 0) exceptionHandlingTimes.push(diff);
    }
  }

  const avgConfirmationSeconds = confirmationTimes.length > 0
    ? Math.round(confirmationTimes.reduce((a, b) => a + b, 0) / confirmationTimes.length)
    : null;
  const avgHandlingSeconds = exceptionHandlingTimes.length > 0
    ? Math.round(exceptionHandlingTimes.reduce((a, b) => a + b, 0) / exceptionHandlingTimes.length)
    : null;

  const formatDuration = (seconds) => {
    if (seconds === null) return null;
    if (seconds < 60) return `${seconds}秒`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return `${m}分${s > 0 ? s + '秒' : ''}`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}时${rm > 0 ? rm + '分' : ''}`;
  };

  const riskOrders = [];
  const riskStats = { high: 0, medium: 0, low: 0 };
  for (const order of orders) {
    const orderNotifs = allNotifs.filter(n => n.order_id === order.id);
    const orderExcs = allExcs.filter(e => e.order_id === order.id);
    const risk = calcRiskLevel(order, orderNotifs, orderExcs, now);
    if (risk.reasons.length > 0) {
      riskStats[risk.level]++;
      riskOrders.push({
        order_id: order.id,
        order_no: order.order_no,
        game_date: order.game_date,
        room: order.room,
        script_name: order.script_name,
        main_player_name: order.main_player_name,
        dm_name: order.dm_name,
        risk_level: risk.level,
        risk_level_label: risk.level_label,
        risk_score: risk.score,
        risk_factors: risk.reasons,
        failed_notification_count: orderNotifs.filter(n => n.status === 'failed').length,
        unconfirmed_notification_count: orderNotifs.filter(n => n.status === 'sent' && n.confirmed !== 1).length,
        overdue_exception_count: overdueList.filter(o => o.order_id === order.id).length
      });
    }
  }
  riskOrders.sort((a, b) => b.risk_score - a.risk_score);

  return {
    date,
    order_count: orders.length,
    notification_stats: {
      total: totalNotifications,
      sent: sentNotifications,
      failed: failedNotifications,
      confirmed: confirmedNotifications,
      reach_rate: totalNotifications > 0 ? Math.round(sentNotifications / totalNotifications * 100) + '%' : '0%',
      confirm_rate: sentNotifications > 0 ? Math.round(confirmedNotifications / sentNotifications * 100) + '%' : '0%',
      avg_confirmation_seconds: avgConfirmationSeconds,
      avg_confirmation_time: formatDuration(avgConfirmationSeconds)
    },
    exception_stats: {
      total: totalExceptions,
      resolved: resolvedExceptions,
      overdue: overdueUnresolved,
      resolved_late: overdueResolvedLate,
      total_overdue: overdueList.length,
      resolve_rate: totalExceptions > 0 ? Math.round(resolvedExceptions / totalExceptions * 100) + '%' : '0%',
      avg_handling_seconds: avgHandlingSeconds,
      avg_handling_time: formatDuration(avgHandlingSeconds)
    },
    risk_stats: riskStats,
    orders: orders.map(o => ({
      id: o.id, order_no: o.order_no, game_date: o.game_date, room: o.room,
      script_name: o.script_name, main_player_name: o.main_player_name,
      dm_name: o.dm_name, player_count: o.player_count,
      cake_confirmed: !!o.cake_confirmed, decoration_confirmed: !!o.decoration_confirmed, status: o.status
    })),
    risk_orders: riskOrders
  };
};

module.exports = {
  calcOverdueExceptions,
  calcRiskLevel,
  summarizeDay,
  list: (req, res) => {
    const list = StoreConfigModel.list();
    res.json({ code: 200, data: list });
  },

  get: (req, res) => {
    const { key } = req.params;
    const config = StoreConfigModel.getByKey(key || 'default');
    if (!config) {
      return res.status(404).json({ code: 404, message: '门店配置不存在' });
    }
    res.json({ code: 200, data: config });
  },

  create: (req, res) => {
    const { store_key, store_name } = req.body;
    if (!store_key || !store_name) {
      return res.status(400).json({ code: 400, message: 'store_key 和 store_name 为必填项' });
    }
    if (StoreConfigModel.getByKey(store_key)) {
      return res.status(400).json({ code: 400, message: `store_key 已存在` });
    }
    try {
      const created = StoreConfigModel.create(req.body);
      res.json({ code: 200, message: '创建成功', data: created });
    } catch (err) {
      res.status(500).json({ code: 500, message: err.message });
    }
  },

  update: (req, res) => {
    const { key } = req.params;
    const existing = StoreConfigModel.getByKey(key || 'default');
    if (!existing) {
      return res.status(404).json({ code: 404, message: '门店配置不存在' });
    }
    try {
      const updated = StoreConfigModel.update(existing.id, req.body);
      res.json({ code: 200, message: '更新成功', data: updated });
    } catch (err) {
      res.status(500).json({ code: 500, message: err.message });
    }
  },

  delete: (req, res) => {
    const { key } = req.params;
    const existing = StoreConfigModel.getByKey(key);
    if (!existing) {
      return res.status(404).json({ code: 404, message: '门店配置不存在' });
    }
    StoreConfigModel.delete(existing.id);
    res.json({ code: 200, message: '删除成功' });
  },

  channelTypes: (req, res) => {
    res.json({
      code: 200,
      data: Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))
    });
  },

  previewChannelForRole: (req, res) => {
    const { key } = req.params;
    const { role } = req.query;
    const info = StoreConfigModel.getChannelForRole(role, key || 'default');
    if (!info) {
      return res.status(400).json({ code: 400, message: '未找到对应渠道配置' });
    }
    res.json({
      code: 200,
      data: {
        role,
        channel_type: info.type,
        channel_label: CHANNEL_LABELS[info.type] || info.type,
        channel_config: info.config,
        default_target: info.target
      }
    });
  },

  dashboard: (req, res) => {
    const { key } = req.params;
    const { date } = req.query;
    const storeKey = key || 'default';
    const targetDate = date || dayjs().format('YYYY-MM-DD');

    const storeConfig = StoreConfigModel.getByKey(storeKey);
    if (!storeConfig) {
      return res.status(404).json({ code: 404, message: '门店配置不存在' });
    }

    const orders = OrderModel.getByDateAndStore(targetDate, storeKey);
    const orderIds = orders.map(o => o.id);

    let pendingNotifications = [];
    let unconfirmedNotifications = [];
    let processingExceptions = [];
    let overdueExceptions = [];

    if (orderIds.length > 0) {
      const allNotifs = NotificationModel.getByOrderIds(orderIds);
      pendingNotifications = allNotifs.filter(n => n.status === 'pending');
      unconfirmedNotifications = allNotifs.filter(n => n.status !== 'pending' && n.confirmed !== 1);

      const allExcs = ExceptionModel.getByOrderIds(orderIds);
      processingExceptions = allExcs.filter(e =>
        e.status !== 'resolved' && e.status !== 'ignored'
      );
      const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
      overdueExceptions = calcOverdueExceptions(allExcs, now).filter(o => o._overdue_type === 'unresolved');
    }

    res.json({
      code: 200,
      data: {
        store_key: storeKey,
        store_name: storeConfig.store_name,
        date: targetDate,
        stats: {
          order_count: orders.length,
          pending_notification_count: pendingNotifications.length,
          unconfirmed_notification_count: unconfirmedNotifications.length,
          processing_exception_count: processingExceptions.length,
          overdue_exception_count: overdueExceptions.length
        },
        orders: orders.map(o => ({
          id: o.id,
          order_no: o.order_no,
          game_date: o.game_date,
          room: o.room,
          script_name: o.script_name,
          player_count: o.player_count,
          main_player_name: o.main_player_name,
          dm_name: o.dm_name,
          status: o.status,
          cake_confirmed: !!o.cake_confirmed,
          decoration_confirmed: !!o.decoration_confirmed
        })),
        pending_notifications: pendingNotifications.map(n => ({
          id: n.id,
          order_id: n.order_id,
          order_no: n.order_no,
          type: n.type,
          role: n.role,
          scheduled_time: n.scheduled_time,
          channel: n.channel,
          channel_target: n.channel_target
        })),
        unconfirmed_notifications: unconfirmedNotifications.map(n => ({
          id: n.id,
          order_id: n.order_id,
          order_no: n.order_no,
          type: n.type,
          role: n.role,
          sent_time: n.sent_time,
          channel: n.channel,
          send_attempts: n.send_attempts
        })),
        processing_exceptions: processingExceptions.map(e => ({
          id: e.id,
          order_id: e.order_id,
          order_no: e.order_no,
          type: e.type,
          description: e.description,
          status: e.status,
          assignee: e.assignee,
          deadline: e.deadline,
          is_overdue: e.deadline && e.deadline <= dayjs().format('YYYY-MM-DD HH:mm:ss'),
          escalated: !!e.escalated
        })),
        overdue_exceptions: overdueExceptions.map(e => ({
          id: e.id,
          order_id: e.order_id,
          order_no: e.order_no,
          type: e.type,
          description: e.description,
          assignee: e.assignee,
          deadline: e.deadline,
          escalated: !!e.escalated
        }))
      }
    });
  },

  dailyReport: (req, res) => {
    const { key } = req.params;
    const { date } = req.query;
    const storeKey = key || 'default';
    const targetDate = date || dayjs().format('YYYY-MM-DD');

    const storeConfig = StoreConfigModel.getByKey(storeKey);
    if (!storeConfig) {
      return res.status(404).json({ code: 404, message: '门店配置不存在' });
    }

    const summary = summarizeDay(targetDate, storeKey);

    res.json({
      code: 200,
      data: {
        store_key: storeKey,
        store_name: storeConfig.store_name,
        date: targetDate,
        summary: {
          order_count: summary.order_count,
          notification_stats: summary.notification_stats,
          exception_stats: summary.exception_stats,
          risk_stats: summary.risk_stats
        },
        risk_orders: summary.risk_orders,
        orders: summary.orders
      }
    });
  },

  weeklyTrend: (req, res) => {
    const { key } = req.params;
    const { end_date } = req.query;
    const storeKey = key || 'default';
    const endDate = end_date ? dayjs(end_date) : dayjs();

    const storeConfig = StoreConfigModel.getByKey(storeKey);
    if (!storeConfig) {
      return res.status(404).json({ code: 404, message: '门店配置不存在' });
    }

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = endDate.subtract(i, 'day').format('YYYY-MM-DD');
      days.push(summarizeDay(d, storeKey));
    }

    const fluctuations = [];
    for (let i = 1; i < days.length; i++) {
      const prev = days[i - 1];
      const curr = days[i];
      const metrics = [
        { key: 'order_count', label: '订单量', prev: prev.order_count, curr: curr.order_count },
        { key: 'reach_rate', label: '通知触达率',
          prev: prev.notification_stats.reach_rate, curr: curr.notification_stats.reach_rate,
          prevVal: parseInt(prev.notification_stats.reach_rate) || 0,
          currVal: parseInt(curr.notification_stats.reach_rate) || 0 },
        { key: 'confirm_rate', label: '通知确认率',
          prev: prev.notification_stats.confirm_rate, curr: curr.notification_stats.confirm_rate,
          prevVal: parseInt(prev.notification_stats.confirm_rate) || 0,
          currVal: parseInt(curr.notification_stats.confirm_rate) || 0 },
        { key: 'total_overdue', label: '异常超时数',
          prev: prev.exception_stats.total_overdue || 0, curr: curr.exception_stats.total_overdue || 0 },
        { key: 'high_risk', label: '高风险订单数',
          prev: prev.risk_stats.high, curr: curr.risk_stats.high }
      ];
      for (const m of metrics) {
        const pv = m.prevVal !== undefined ? m.prevVal : m.prev;
        const cv = m.currVal !== undefined ? m.currVal : m.curr;
        const diff = Number(cv) - Number(pv);
        const absDiff = Math.abs(diff);
        if (absDiff > 0) {
          fluctuations.push({
            date: curr.date,
            metric_key: m.key,
            metric_label: m.label,
            prev_value: pv,
            curr_value: cv,
            diff,
            diff_abs: absDiff,
            direction: diff > 0 ? 'up' : 'down',
            severity: m.key === 'high_risk' || m.key === 'total_overdue' ? 'high' : 'normal'
          });
        }
      }
    }
    fluctuations.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
      return b.diff_abs - a.diff_abs;
    });

    const totalOrders = days.reduce((s, d) => s + d.order_count, 0);
    const totalSent = days.reduce((s, d) => s + d.notification_stats.sent, 0);
    const totalNotif = days.reduce((s, d) => s + d.notification_stats.total, 0);
    const totalOverdue = days.reduce((s, d) => s + (d.exception_stats.total_overdue || 0), 0);
    const totalRisks = days.reduce((s, d) => s + d.risk_orders.length, 0);

    res.json({
      code: 200,
      data: {
        store_key: storeKey,
        store_name: storeConfig.store_name,
        period_start: days[0].date,
        period_end: days[6].date,
        total_summary: {
          total_orders: totalOrders,
          avg_orders_per_day: Math.round(totalOrders / 7 * 10) / 10,
          avg_reach_rate: totalNotif > 0 ? Math.round(totalSent / totalNotif * 100) + '%' : '0%',
          total_overdue_exceptions: totalOverdue,
          total_risk_orders: totalRisks
        },
        daily_trend: days.map(d => ({
          date: d.date,
          weekday: dayjs(d.date).format('ddd'),
          order_count: d.order_count,
          notification_stats: d.notification_stats,
          exception_stats: d.exception_stats,
          risk_stats: d.risk_stats
        })),
        top_fluctuations: fluctuations.slice(0, 10),
        biggest_change_date: fluctuations.length > 0 ? {
          date: fluctuations[0].date,
          metric_label: fluctuations[0].metric_label,
          prev_value: fluctuations[0].prev_value,
          curr_value: fluctuations[0].curr_value,
          direction: fluctuations[0].direction,
          diff: fluctuations[0].diff
        } : null
      }
    });
  }
};
