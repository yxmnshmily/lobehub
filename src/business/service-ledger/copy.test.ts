import { describe, expect, it } from 'vitest';

import { travelServiceLedgerCopy } from './copy';

const allCopy = JSON.stringify(travelServiceLedgerCopy);

describe('travel service ledger page copy', () => {
  it('states that balance comes from the audited ledger while online payment is closed', () => {
    expect(travelServiceLedgerCopy.balance.description).toContain('可审计的旅行服务费账本');
    expect(travelServiceLedgerCopy.balance.paymentNotice).toContain('当前未开通在线支付');
    expect(allCopy).not.toContain('LobeHub Cloud');
    expect(allCopy).not.toMatch(/¥|\uFFE5/);
    expect(allCopy).not.toContain('立即充值');
  });

  it('keeps records empty until audited entries exist', () => {
    expect(travelServiceLedgerCopy.records.emptyTitle).toBe('暂无记录');
    expect(travelServiceLedgerCopy.records.description).toContain('只显示已写入真实账本');
  });

  it('describes real audited administrator operations without implying online payment', () => {
    expect(travelServiceLedgerCopy.admin.description).toContain('订单创建');
    expect(travelServiceLedgerCopy.admin.description).toContain('人工调账');
    expect(travelServiceLedgerCopy.admin.description).toContain('单次冲正');
    expect(travelServiceLedgerCopy.admin.pending).toBe('正在读取');
    expect(travelServiceLedgerCopy.admin.emptyDescription).toContain('不会发起在线支付或自动扣费');
  });
});
