const { StoreConfigModel } = require('../models');

const CHANNEL_LABELS = {
  wecom: '企业微信群机器人',
  sms: '短信接口',
  dingtalk: '钉钉群机器人',
  console: '控制台输出'
};

module.exports = {
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
  }
};
