import { and, eq, isNull, sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '@/database/type';

import { permissions, rolePermissions, roles, userRoles, users } from '../schemas';

export const PLATFORM_ADMIN_ROLE = 'super_admin';

export const getActivePlatformAdminCount = async (db: LobeChatDatabase): Promise<number> => {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(
      and(
        isNull(userRoles.workspaceId),
        eq(roles.name, PLATFORM_ADMIN_ROLE),
        eq(roles.isActive, true),
        sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
      ),
    );

  return Number(result?.count || 0);
};

/** Explicit, persistent and idempotent platform-admin bootstrap. */
export const bootstrapPlatformAdmin = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<void> => {
  if (!userId || userId.trim() !== userId) throw new Error('A valid exact user id is required');

  await db.transaction(async (tx) => {
    const user = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new Error(`User id does not exist: ${userId}`);

    await tx
      .insert(roles)
      .values({
        description: 'Platform administrator with all system permissions',
        displayName: 'Super Admin',
        isActive: true,
        isSystem: true,
        name: PLATFORM_ADMIN_ROLE,
        workspaceId: null,
      })
      .onConflictDoNothing();

    const role = await tx.query.roles.findFirst({
      where: and(eq(roles.name, PLATFORM_ADMIN_ROLE), isNull(roles.workspaceId)),
    });
    if (!role) throw new Error('Failed to create the platform administrator role');

    await tx.update(roles).set({ isActive: true, isSystem: true }).where(eq(roles.id, role.id));

    const activePermissions = await tx
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.isActive, true));
    if (activePermissions.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(activePermissions.map(({ id }) => ({ permissionId: id, roleId: role.id })))
        .onConflictDoNothing();
    }

    await tx
      .insert(userRoles)
      .values({ roleId: role.id, userId, workspaceId: null })
      .onConflictDoNothing();
  });
};
