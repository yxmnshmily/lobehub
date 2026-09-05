import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { getServerDB } from '@/database/core/db-adaptor';
import { RbacModel } from '@/database/models/rbac';

const denyPlatformAdminAccess = (): never => {
  throw new HTTPException(403, { message: 'Platform administrator access is required' });
};

/** Protects platform-wide administration independently of workspace RBAC. */
export const requirePlatformAdmin = async (c: Context, next: Next) => {
  const userId = c.get('userId') as string | null | undefined;
  if (!userId) throw new HTTPException(401, { message: 'Authentication required' });

  const db = await getServerDB();
  const account = await db.query.users.findFirst({
    columns: { banned: true, id: true },
    where: (users, { eq }) => eq(users.id, userId),
  });

  if (!account || account.banned === true) denyPlatformAdminAccess();

  const isPlatformAdmin = await new RbacModel(db, userId).hasGlobalRole('super_admin');
  if (!isPlatformAdmin) denyPlatformAdminAccess();

  return next();
};
