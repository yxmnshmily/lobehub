import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { RbacModel } from '@/database/models/rbac';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { trpc } from '@/libs/trpc/lambda/init';

type GlobalRoleReader = Pick<RbacModel, 'hasGlobalRole'>;

export const assertPlatformAdmin = async (rbac: GlobalRoleReader): Promise<void> => {
  if (await rbac.hasGlobalRole('super_admin')) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Platform administrator access is required',
  });
};

export const hasActivePlatformAdminAccess = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<boolean> => {
  const account = await db.query.users.findFirst({
    columns: { banned: true, id: true },
    where: eq(users.id, userId),
  });
  if (!account || account.banned === true) return false;

  return new RbacModel(db, userId).hasGlobalRole('super_admin');
};

/** Protects platform-wide settings independently of menu visibility. */
export const requirePlatformAdmin = trpc.middleware(async ({ ctx, next }) => {
  // This guard is deliberately attached after `serverDatabase` on every
  // protected procedure. tRPC types independently-created middleware against
  // the base context, so make that runtime contract explicit and still fail
  // closed if a caller wires the guard in the wrong order.
  const guardedContext = ctx as typeof ctx & { serverDB?: LobeChatDatabase };
  if (!guardedContext.serverDB) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database context is required' });
  }
  if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in required' });

  if (!(await hasActivePlatformAdminAccess(guardedContext.serverDB, ctx.userId))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Platform administrator access is required',
    });
  }
  return next();
});
