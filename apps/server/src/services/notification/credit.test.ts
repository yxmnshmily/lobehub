// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

import { NOTIFICATION_EVENTS } from '@/const/settings/notificationEvents';
import type { PlatformCreditEntryItem } from '@/database/schemas/platformCredit';

import { notifyCreditEntry } from './credit';

const emit = vi.hoisted(() => vi.fn(async (_event: unknown) => {}));
vi.mock('./index', () => ({ notifyUser: emit }));
beforeEach(() => emit.mockClear());

const entry = (patch: Partial<PlatformCreditEntryItem> = {}) =>
  ({
    id: 'ledger-entry',
    userId: 'payer',
    userIdSnapshot: 'payer',
    actorUserId: 'group-member',
    workspaceId: 'group-workspace',
    type: 'usage_charge',
    amountCredits: -100,
    balanceAfterCredits: 0,
    ...patch,
  }) as PlatformCreditEntryItem;

it('notifies the actual payer when a committed charge exhausts the balance', async () => {
  await notifyCreditEntry(entry());
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'payer',
      type: 'credits_exhausted',
      eventId: 'ledger-entry',
      actionUrl: '/settings/credits',
    }),
  );
  expect(emit.mock.calls[0][0]).not.toHaveProperty('workspaceId');
});

it('notifies confirmed top-ups using the ledger identity', async () => {
  await notifyCreditEntry(entry({ type: 'top_up', amountCredits: 100, balanceAfterCredits: 200 }));
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'payer',
      type: 'credits_top_up_completed',
      eventId: 'ledger-entry',
    }),
  );
});

it.each([
  { balanceAfterCredits: 1 },
  { amountCredits: 0 },
  { userId: null },
  { type: 'reversal' },
  { balanceAfterCredits: Number.NaN },
] as Partial<PlatformCreditEntryItem>[])('does not mislabel a non-event: %j', async (patch) => {
  await notifyCreditEntry(entry(patch));
  expect(emit).not.toHaveBeenCalled();
});

it('exposes both billing events in the shared channel catalog', () => {
  expect(NOTIFICATION_EVENTS).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'credits_exhausted', category: 'billing' }),
      expect.objectContaining({ type: 'credits_top_up_completed', category: 'billing' }),
    ]),
  );
});

it('warns only when consumption crosses into a low balance, not on every debit', async () => {
  await notifyCreditEntry(entry({ amountCredits: -20_000, balanceAfterCredits: 90_000 }));
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'credits_low' }));
  emit.mockClear();
  await notifyCreditEntry(entry({ amountCredits: -10_000, balanceAfterCredits: 80_000 }));
  expect(emit).not.toHaveBeenCalled();
});
it.each([
  ['adjustment', -20, 'credits_adjusted'],
  ['adjustment', 20, 'credits_adjusted'],
  ['reversal', 20, 'credits_returned'],
] as const)(
  'reports committed %s without mislabelling it as a recharge',
  async (type, amountCredits, expected) => {
    await notifyCreditEntry(entry({ type, amountCredits, balanceAfterCredits: 100 }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: expected, userId: 'payer' }));
  },
);
