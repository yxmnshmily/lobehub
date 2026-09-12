// @vitest-environment node
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { platformCreditAccounts, platformCreditEntries, users } from '../schemas';
import { deleteManagedUser } from './deleteManagedUser';

it('permanently deletes the target and owned credit ledger without deleting another user', async () => {
  const db = await getTestDB();
  await db.insert(users).values([{ id: 'purge-target' }, { id: 'purge-other' }]);
  const [account] = await db
    .insert(platformCreditAccounts)
    .values({ userId: 'purge-target', userIdSnapshot: 'purge-target' })
    .returning();
  await db.insert(platformCreditEntries).values({
    accountId: account.id,
    userId: 'purge-target',
    userIdSnapshot: 'purge-target',
    type: 'top_up',
    amountCredits: 1,
    balanceAfterCredits: 1,
    reason: 'test',
    idempotencyKey: 'purge-test',
  });
  await deleteManagedUser(db, 'purge-target');
  expect(await db.select().from(users).where(eq(users.id, 'purge-target'))).toHaveLength(0);
  expect(
    await db
      .select()
      .from(platformCreditEntries)
      .where(eq(platformCreditEntries.accountId, account.id)),
  ).toHaveLength(0);
  expect(await db.select().from(users).where(eq(users.id, 'purge-other'))).toHaveLength(1);
});
