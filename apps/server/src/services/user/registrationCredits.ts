import type { LobeChatDatabase } from '@lobechat/database';
import { platformCreditAccounts, platformCreditEntries, users } from '@lobechat/database/schemas';
import { and, eq, sql } from 'drizzle-orm';

// Fixed policy boundary: login recovery must never enroll pre-existing accounts.
const STARTS_AT = new Date('2026-09-06T10:43:24Z');
const CREDITS = 5_000_000;
const IDEMPOTENCY_KEY = 'registration-gift:v1';

/** Attribute consumption to the one-time gift first; recharges never refill it. */
export const getRegistrationCredits = async (db: LobeChatDatabase, userId: string) => {
  const [gift] = await db
    .select({
      totalCredits: platformCreditEntries.amountCredits,
      remainingCredits: sql<number>`case when exists (
      select 1 from platform_credit_entries reversed
      where reversed.reversal_of_entry_id = ${platformCreditEntries.id}
    ) then 0 else greatest(0, least(${platformCreditAccounts.balanceCredits},
      ${platformCreditEntries.amountCredits} + coalesce((
        select sum(consumed.amount_credits)
        from platform_credit_entries consumed
        left join platform_credit_entries original on original.id = consumed.reversal_of_entry_id
        where consumed.account_id = ${platformCreditEntries.accountId}
          and consumed.created_at >= ${platformCreditEntries.createdAt}
          and (consumed.type = 'usage_charge'
            or (consumed.type = 'adjustment' and consumed.amount_credits < 0)
            or (consumed.type = 'reversal' and (original.type = 'usage_charge' or (original.type = 'adjustment' and original.amount_credits < 0))))
      ), 0)
    )) end`.mapWith(Number),
    })
    .from(platformCreditEntries)
    .innerJoin(
      platformCreditAccounts,
      eq(platformCreditAccounts.id, platformCreditEntries.accountId),
    )
    .where(
      and(
        eq(platformCreditEntries.userIdSnapshot, userId),
        eq(platformCreditEntries.idempotencyKey, IDEMPOTENCY_KEY),
      ),
    )
    .limit(1);
  if (!gift) return { remainingCredits: 0, totalCredits: 0 };
  if (
    !Number.isSafeInteger(gift.remainingCredits) ||
    !Number.isSafeInteger(gift.totalCredits) ||
    gift.totalCredits < 0
  )
    throw new Error('Invalid registration credit summary');
  return gift;
};

/** Server-only bootstrap; no client-selected amount, recipient, or claim endpoint. */
export const grantRegistrationCredits = async (db: LobeChatDatabase, userId: string) =>
  db.transaction(async (tx) => {
    const [user] = await tx
      .select({ createdAt: users.createdAt, banned: users.banned })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || user.banned || user.createdAt < STARTS_AT) return;

    await tx
      .insert(platformCreditAccounts)
      .values({ userId, userIdSnapshot: userId })
      .onConflictDoNothing({ target: platformCreditAccounts.userIdSnapshot });
    const [account] = await tx
      .select()
      .from(platformCreditAccounts)
      .where(eq(platformCreditAccounts.userIdSnapshot, userId))
      .limit(1)
      .for('update');
    if (!account) throw new Error('Registration credit account unavailable');
    const [existing] = await tx
      .select({ id: platformCreditEntries.id })
      .from(platformCreditEntries)
      .where(
        and(
          eq(platformCreditEntries.accountId, account.id),
          eq(platformCreditEntries.idempotencyKey, IDEMPOTENCY_KEY),
        ),
      )
      .limit(1);
    if (existing) return;

    const balanceAfterCredits = account.balanceCredits + CREDITS;
    if (!Number.isSafeInteger(balanceAfterCredits) || account.balanceCredits < 0)
      throw new Error('Invalid registration credit balance');
    await tx.insert(platformCreditEntries).values({
      accountId: account.id,
      userId,
      userIdSnapshot: userId,
      type: 'adjustment',
      amountCredits: CREDITS,
      balanceAfterCredits,
      reason: '新用户首次注册赠送500万积分，无需充值',
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    await tx
      .update(platformCreditAccounts)
      .set({ balanceCredits: balanceAfterCredits, updatedAt: new Date() })
      .where(eq(platformCreditAccounts.id, account.id));
  });
