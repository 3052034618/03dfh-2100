const dayjs = require('dayjs');

const _shouldFail = (config) => {
  return !!(config && config.force_fail);
};

const _failReason = (config, defaultReason) => {
  return (config && config.force_fail_reason) || defaultReason;
};

const ChannelSender = {
  async send(channelType, channelConfig, content, target, order) {
    const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss');
    switch (channelType) {
      case 'wecom':
        return this._sendWecom(channelConfig, content, target, timestamp);
      case 'sms':
        return this._sendSms(channelConfig, content, target, order, timestamp);
      case 'dingtalk':
        return this._sendDingtalk(channelConfig, content, target, timestamp);
      case 'console':
      default:
        return this._sendConsole(content, target, timestamp);
    }
  },

  _sendWecom(config, content, target, timestamp) {
    const webhookUrl = config && config.webhook_url ? config.webhook_url : '未配置webhook';
    console.log('\n' + '-'.repeat(60));
    console.log(`[企业微信机器人] ${timestamp}`);
    console.log(`  Webhook: ${webhookUrl}`);
    console.log(`  @接收人: ${target || '群内所有人'}`);
    console.log('  消息内容:');
    content.split('\n').forEach(line => console.log(`    ${line}`));
    console.log('-'.repeat(60) + '\n');
    if (_shouldFail(config)) {
      const reason = _failReason(config, '机器人返回 40001，token 无效');
      return {
        success: false,
        channel: 'wecom',
        target: target || 'group',
        result: JSON.stringify({ errcode: 40001, errmsg: reason }),
        description: `企业微信发送失败: ${reason}`,
        error: reason
      };
    }
    const mockResponse = {
      errcode: 0,
      errmsg: 'ok',
      msgid: 'WM' + dayjs().format('YYYYMMDDHHmmssSSS') + Math.floor(Math.random() * 1000)
    };
    return {
      success: true,
      channel: 'wecom',
      target: target || 'group',
      result: JSON.stringify(mockResponse),
      description: `企业微信发送成功 (msgid: ${mockResponse.msgid})`
    };
  },

  _sendSms(config, content, target, order, timestamp) {
    const phone = order && order.main_player_phone ? order.main_player_phone : (target || '未提供手机号');
    const sign = config && config.sign ? config.sign : '【剧本杀】';
    const gateway = config && config.gateway ? config.gateway : '模拟网关';
    const text = sign + content.replace(/\n/g, ' ').slice(0, 500);
    console.log('\n' + '-'.repeat(60));
    console.log(`[短信接口] ${timestamp}`);
    console.log(`  网关: ${gateway}`);
    console.log(`  手机号: ${phone}`);
    console.log(`  短信内容: ${text}`);
    console.log('-'.repeat(60) + '\n');
    if (_shouldFail(config)) {
      const reason = _failReason(config, '运营商通道繁忙，请稍后重试');
      return {
        success: false,
        channel: 'sms',
        target: phone,
        result: JSON.stringify({ code: '500', msg: reason, sms_id: null }),
        description: `短信发送失败: ${reason}`,
        error: reason
      };
    }
    const mockResponse = {
      code: '0',
      msg: '发送成功',
      sms_id: 'SMS' + dayjs().format('YYYYMMDDHHmmssSSS'),
      fee: 0.05
    };
    return {
      success: true,
      channel: 'sms',
      target: phone,
      result: JSON.stringify(mockResponse),
      description: `短信发送成功 (ID: ${mockResponse.sms_id}, 扣费: ${mockResponse.fee}元)`
    };
  },

  _sendDingtalk(config, content, target, timestamp) {
    const webhookUrl = config && config.webhook_url ? config.webhook_url : '未配置webhook';
    console.log('\n' + '-'.repeat(60));
    console.log(`[钉钉机器人] ${timestamp}`);
    console.log(`  Webhook: ${webhookUrl}`);
    console.log(`  @接收人: ${target || '群内所有人'}`);
    console.log('  消息内容:');
    content.split('\n').forEach(line => console.log(`    ${line}`));
    console.log('-'.repeat(60) + '\n');
    if (_shouldFail(config)) {
      const reason = _failReason(config, '签名校验失败');
      return {
        success: false,
        channel: 'dingtalk',
        target: target || 'group',
        result: JSON.stringify({ errcode: 310000, errmsg: reason }),
        description: `钉钉发送失败: ${reason}`,
        error: reason
      };
    }
    const mockResponse = { errcode: 0, errmsg: 'ok' };
    return {
      success: true,
      channel: 'dingtalk',
      target: target || 'group',
      result: JSON.stringify(mockResponse),
      description: '钉钉发送成功'
    };
  },

  _sendConsole(content, target, timestamp) {
    console.log('\n' + '-'.repeat(60));
    console.log(`[控制台输出] ${timestamp} | 目标: ${target || '未指定'}`);
    console.log('  消息内容:');
    content.split('\n').forEach(line => console.log(`    ${line}`));
    console.log('-'.repeat(60) + '\n');
    return {
      success: true,
      channel: 'console',
      target: target || '-',
      result: JSON.stringify({ mode: 'console' }),
      description: '控制台输出成功'
    };
  }
};

module.exports = ChannelSender;
