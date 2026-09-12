import type { PlatformCreditEntryItem } from '@/database/schemas/platformCredit';

import { notifyUser } from './index';

/** Call only after ledger commit. Billing belongs to the payer's personal account. */
export async function notifyCreditEntry(entry: PlatformCreditEntryItem) {
  if (!entry.userId || !Number.isSafeInteger(entry.balanceAfterCredits)) return;

  if (entry.type === 'top_up' && entry.amountCredits > 0) {
    await notifyUser({
      actionUrl: '/settings/credits',
      content: '充值积分已到账，可在积分余额中查看入账明细。',
      eventId: entry.id,
      type: 'credits_top_up_completed',
      userId: entry.userId,
    });
  } else if (
    entry.type === 'usage_charge' &&
    entry.amountCredits < 0 &&
    entry.balanceAfterCredits === 0
  ) {
    await notifyUser({
      actionUrl: '/settings/credits',
      content: '您的积分已消耗完毕，请充值后继续使用需要积分的服务。',
      eventId: entry.id,
      type: 'credits_exhausted',
      userId: entry.userId,
    });
  } else if (
    entry.type === 'usage_charge' &&
    entry.amountCredits < 0 &&
    entry.balanceAfterCredits > 0 &&
    entry.balanceAfterCredits < 100_000 &&
    entry.balanceAfterCredits - entry.amountCredits >= 100_000
  ) {
    await notifyUser({
      userId: entry.userId,
      eventId: entry.id,
      type: 'credits_low',
      content: '积分余额已低于10万，请留意剩余积分，避免任务因余额不足中断。',
      actionUrl: '/settings/credits',
    });
  } else if (entry.type === 'adjustment' && entry.amountCredits !== 0) {
    await notifyUser({
      userId: entry.userId,
      eventId: entry.id,
      type: 'credits_adjusted',
      content: '你的积分账户发生了账务调整，请到积分余额查看明细。',
      actionUrl: '/settings/credits',
    });
  } else if (entry.type === 'reversal' && entry.amountCredits > 0) {
    await notifyUser({
      userId: entry.userId,
      eventId: entry.id,
      type: 'credits_returned',
      content: '一笔积分已退回账户，请到积分余额查看明细。',
      actionUrl: '/settings/credits',
    });
  }
}
