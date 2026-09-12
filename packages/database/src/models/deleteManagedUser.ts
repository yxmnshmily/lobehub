import { and, eq, inArray, or } from 'drizzle-orm';

import {
  platformCreditAccounts,
  platformCreditBudgets,
  platformCreditPaymentEvents,
  platformCreditPurchaseOrders,
  platformCreditReservations,
  platformModerationAudits,
  travelServiceAccounts,
  users,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { UserModel } from './user';

/** Explicit permanent deletion; unlike ordinary account removal, purges owned ledgers. */
export async function deleteManagedUser(db: LobeChatDatabase, userId: string) {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!target) throw new Error('用户不存在');
    const activeBudgets = await tx
      .select({ id: platformCreditBudgets.id })
      .from(platformCreditBudgets)
      .where(
        and(
          or(
            eq(platformCreditBudgets.userIdSnapshot, userId),
            eq(platformCreditBudgets.actorUserIdSnapshot, userId),
          ),
          eq(platformCreditBudgets.status, 'active'),
        ),
      )
      .limit(1);
    if (activeBudgets.length) throw new Error('用户仍有运行中的计费任务，请结束后再删除');
    const orders = tx
      .select({ id: platformCreditPurchaseOrders.id })
      .from(platformCreditPurchaseOrders)
      .where(eq(platformCreditPurchaseOrders.userIdSnapshot, userId));
    await tx
      .delete(platformCreditPaymentEvents)
      .where(inArray(platformCreditPaymentEvents.orderId, orders));
    await tx
      .delete(platformCreditPurchaseOrders)
      .where(eq(platformCreditPurchaseOrders.userIdSnapshot, userId));
    const accounts = tx
      .select({ id: platformCreditAccounts.id })
      .from(platformCreditAccounts)
      .where(eq(platformCreditAccounts.userIdSnapshot, userId));
    // Reservations restrict entry deletion; delete them before the account cascades.
    await tx
      .delete(platformCreditReservations)
      .where(inArray(platformCreditReservations.accountId, accounts));
    await tx
      .delete(platformCreditAccounts)
      .where(eq(platformCreditAccounts.userIdSnapshot, userId));
    await tx.delete(travelServiceAccounts).where(eq(travelServiceAccounts.userIdSnapshot, userId));
    await tx
      .delete(platformModerationAudits)
      .where(eq(platformModerationAudits.userIdSnapshot, userId));
    // Retains the canonical transfer guard and shared-agent visitor-topic cleanup.
    await UserModel.deleteUser(tx as LobeChatDatabase, userId);
    return { id: userId };
  });
}
