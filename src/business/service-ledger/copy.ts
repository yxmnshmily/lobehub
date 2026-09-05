export const travelServiceLedgerCopy = {
  admin: {
    description: '查看用户状态、余额、订单与异常，并执行可审计的订单创建、人工调账和单次冲正。',
    emptyDescription: '当前没有可操作的客户账户。本页不会发起在线支付或自动扣费。',
    emptyTitle: '暂无运营数据',
    pending: '正在读取',
    title: '旅行服务费运营',
  },
  balance: {
    description: '余额来自可审计的旅行服务费账本，以人民币结算。',
    emptyTitle: '正在读取服务余额',
    paymentNotice: '充值仅在管理员核对后记入可审计账本；当前未开通在线支付。',
    title: '服务余额',
  },
  records: {
    description: '只显示已写入真实账本的充值确认、订单和服务扣减记录。',
    emptyTitle: '暂无记录',
    title: '充值、订单与服务记录',
  },
} as const;
