const dayjs = require('dayjs');

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
    const mockResponse = {
      errcode: 0,
      errmsg: 'ok',
      msgid: 'WM' + dayjs().format('YYYYMMDDHHmmssSSS') + Math.floor(Math.random() * 1000)
    };
    return {
      success: mockResponse.errcode === 0,
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
    const mockSuccess = Math.random() > 0.05;
    const mockResponse = {
      code: mockSuccess ? '0' : '500',
      msg: mockSuccess ? '发送成功' : '运营商通道繁忙',
      sms_id: 'SMS' + dayjs().format('YYYYMMDDHHmmssSSS'),
      fee: 0.05
    };
    return {
      success: mockSuccess,
      channel: 'sms',
      target: phone,
      result: JSON.stringify(mockResponse),
      description: mockSuccess
        ? `短信发送成功 (ID: ${mockResponse.sms_id}, 扣费: ${mockResponse.fee}元)`
        : `短信发送失败: ${mockResponse.msg}`
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
    const mockResponse = { errcode: 0, errmsg: 'ok' };
    return {
      success: mockResponse.errcode === 0,
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
