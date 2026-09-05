import { describe, expect, it } from 'vitest';

import {
  createLedgerIdempotencyKey,
  filterReversibleEntries,
  formatCnyFen,
  ledgerTypeLabel,
  orderStatusLabel,
  parseCnyYuanToFen,
  resolveIdempotencyRequest,
} from './viewModel';

describe('travel service ledger view model', () => {
  it('formats integer fen as CNY without changing precision', () => {
    expect(formatCnyFen(0)).toBe('¥0.00');
    expect(formatCnyFen(12_345)).toBe('¥123.45');
    expect(formatCnyFen(-500)).toBe('-¥5.00');
    expect(() => formatCnyFen(1.5)).toThrow('金额必须为整数分');
  });

  it('uses travel-service labels for ledger and order states', () => {
    expect(ledgerTypeLabel('manual_adjustment')).toBe('人工入账');
    expect(ledgerTypeLabel('reversal')).toBe('冲正');
    expect(orderStatusLabel('pending')).toBe('待处理');
  });

  it('parses exact yuan input into bounded integer fen', () => {
    expect(parseCnyYuanToFen('123.45', { allowNegative: false })).toBe(12_345);
    expect(parseCnyYuanToFen('-5.2', { allowNegative: true })).toBe(-520);
    expect(() => parseCnyYuanToFen('1.005', { allowNegative: true })).toThrow('金额最多两位小数');
    expect(() => parseCnyYuanToFen('0', { allowNegative: true })).toThrow('金额不能为 0');
    expect(() => parseCnyYuanToFen('-1', { allowNegative: false })).toThrow('订单金额必须大于 0');
    expect(() => parseCnyYuanToFen('20000000.01', { allowNegative: false })).toThrow(
      '金额超出可用范围',
    );
  });

  it('creates operation-scoped idempotency keys without reusing a previous key', () => {
    expect(createLedgerIdempotencyKey('adjustment', () => 'uuid-1')).toBe(
      'travel-ledger:adjustment:uuid-1',
    );
    expect(createLedgerIdempotencyKey('reversal', () => 'uuid-2')).toBe(
      'travel-ledger:reversal:uuid-2',
    );
  });

  it('keeps only entries that have not already been reversed', () => {
    const entries = [
      { id: 'entry-1', reversalOfEntryId: null, type: 'manual_adjustment' },
      { id: 'entry-2', reversalOfEntryId: null, type: 'service_charge' },
      { id: 'entry-3', reversalOfEntryId: 'entry-1', type: 'reversal' },
    ];

    expect(filterReversibleEntries(entries).map(({ id }) => id)).toEqual(['entry-2']);
  });

  it('reuses an order idempotency key for the same failed submission and rotates after edits', () => {
    const first = resolveIdempotencyRequest(null, 'user-a:12800:行程策划', 'order', () => 'uuid-1');
    const retry = resolveIdempotencyRequest(
      first,
      'user-a:12800:行程策划',
      'order',
      () => 'uuid-unused',
    );
    const edited = resolveIdempotencyRequest(
      retry,
      'user-a:16800:行程策划',
      'order',
      () => 'uuid-2',
    );

    expect(retry.key).toBe('travel-ledger:order:uuid-1');
    expect(edited.key).toBe('travel-ledger:order:uuid-2');
  });
});
