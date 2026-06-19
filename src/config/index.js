const path = require('path');

module.exports = {
  port: process.env.PORT || 3000,
  db: {
    path: path.join(__dirname, '..', 'data', 'app.db')
  },
  notification: {
    checkInterval: '* * * * *',
    dayBefore: {
      hours: 18,
      minutes: 0,
      role: '前台',
      contentTemplate: (order) => `【生日包场提醒-前一天】\n订单号：${order.order_no}\n日期：${order.game_date}\n房间：${order.room}\n剧本：${order.script_name}\n主角：${order.main_player_name}\n\n请核对以下物料：\n1. 生日蛋糕是否已订好/到货\n2. 房间布置物料（气球、横幅等）是否齐全\n3. 附加服务：${order.additional_services || '无'}`
    },
    threeHoursBefore: {
      hours: 3,
      role: 'DM',
      contentTemplate: (order) => `【生日包场提醒-开场前3小时】\n订单号：${order.order_no}\n日期：${order.game_date}\n房间：${order.room}\n剧本：${order.script_name}\n玩家人数：${order.player_count}\n主角：${order.main_player_name}\n\n请确认：\n1. 查看玩家新手比例，调整讲解节奏\n2. 熟悉生日专属流程安排\n3. 准备生日相关彩蛋环节`
    },
    oneHourBefore: {
      hours: 1,
      role: '顾客',
      contentTemplate: (order) => `【生日包场提醒-开场前1小时】\n尊敬的${order.main_player_name}及玩家朋友们：\n剧本：${order.script_name}\n开场时间：${order.game_date}\n房间：${order.room}\n\n到店信息：\n1. 门店地址：XX路XX号XX层\n2. 停车场：地下车库B2层，电梯直达\n3. 联系前台：${order.front_desk_contact || '请咨询门店'}\n\n期待您的光临，祝生日快乐！🎂`
    }
  }
};
