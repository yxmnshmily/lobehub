export const formatCnyFen = (amountFen: number): string => {
  if (!Number.isInteger(amountFen)) throw new Error('金额必须为整数分');
  const sign = amountFen < 0 ? '-' : '';
  return `${sign}¥${(Math.abs(amountFen) / 100).toFixed(2)}`;
};

const MAX_AMOUNT_FEN = 2_000_000_000n;

export const parseCnyYuanToFen = (
  value: string,
  { allowNegative }: { allowNegative: boolean },
): number => {
  const normalized = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error('请输入有效金额');
  const fraction = match[3] ?? '';
  if (fraction.length > 2) throw new Error('金额最多两位小数');

  const absoluteFen = BigInt(match[2]) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  const amountFen = match[1] === '-' ? -absoluteFen : absoluteFen;
  if (amountFen === 0n) throw new Error('金额不能为 0');
  if (!allowNegative && amountFen < 0n) throw new Error('订单金额必须大于 0');
  if (amountFen > MAX_AMOUNT_FEN || amountFen < -MAX_AMOUNT_FEN) {
    throw new Error('金额超出可用范围');
  }
  return Number(amountFen);
};

export const createLedgerIdempotencyKey = (
  operation: 'adjustment' | 'order' | 'reversal',
  randomUUID: () => string = () => globalThis.crypto.randomUUID(),
): string => `travel-ledger:${operation}:${randomUUID()}`;

export interface IdempotencyRequest {
  key: string;
  signature: string;
}

export const resolveIdempotencyRequest = (
  current: IdempotencyRequest | null,
  signature: string,
  operation: 'adjustment' | 'order' | 'reversal',
  randomUUID?: () => string,
): IdempotencyRequest =>
  current?.signature === signature
    ? current
    : { key: createLedgerIdempotencyKey(operation, randomUUID), signature };

export const filterReversibleEntries = <
  T extends { id: string; reversalOfEntryId?: null | string; type: string },
>(
  entries: T[],
): T[] => {
  const reversedEntryIds = new Set(
    entries.flatMap(({ reversalOfEntryId }) => (reversalOfEntryId ? [reversalOfEntryId] : [])),
  );
  return entries.filter(({ id, type }) => type !== 'reversal' && !reversedEntryIds.has(id));
};

export const ledgerTypeLabel = (type: string): string =>
  ({ manual_adjustment: '人工入账', reversal: '冲正', service_charge: '服务扣减' })[type] ?? type;

export const orderStatusLabel = (status: string): string =>
  ({ cancelled: '已取消', completed: '已完成', pending: '待处理', refunded: '已退款' })[status] ??
  status;

export const formatLedgerDate = (value: Date | string): string =>
  new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
