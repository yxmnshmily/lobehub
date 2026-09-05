// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { roles, userRoles, users } from '@/database/schemas';

import { platformAccessRouter } from '../platformAccess';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

const db = await getTestDB();
const adminId = 'platform-access-route-admin';
const ordinaryId = 'platform-access-route-ordinary';

beforeAll(async () => {
  await db.insert(users).values([{ id: adminId }, { id: ordinaryId }]);
  await db
    .insert(roles)
    .values({ displayName: 'Super Admin', isActive: true, isSystem: true, name: 'super_admin' })
    .onConflictDoNothing();
  const role = await db.query.roles.findFirst({ where: eq(roles.name, 'super_admin') });
  if (!role) throw new Error('Missing super_admin role in test setup');
  await db.insert(userRoles).values({ roleId: role.id, userId: adminId, workspaceId: null });
});

afterAll(async () => {
  await db.delete(userRoles).where(eq(userRoles.userId, adminId));
  await db.delete(users).where(eq(users.id, ordinaryId));
  await db.delete(users).where(eq(users.id, adminId));
});

describe('platformAccessRouter', () => {
  it('uses the authenticated identity instead of a forged target user id', async () => {
    const caller = platformAccessRouter.createCaller({ serverDB: db, userId: ordinaryId } as any);

    await expect(
      (caller.isPlatformAdmin as any)({
        email: 'platform-access-route-admin@example.com',
        name: 'super_admin',
        role: 'super_admin',
        userId: adminId,
      }),
    ).resolves.toBe(false);
  });

  it('recognizes an active globally assigned super_admin', async () => {
    const caller = platformAccessRouter.createCaller({ serverDB: db, userId: adminId } as any);

    await expect(caller.isPlatformAdmin()).resolves.toBe(true);
  });

  it('fails closed for a banned super_admin with an existing caller context', async () => {
    await db.update(users).set({ banned: true }).where(eq(users.id, adminId));
    const caller = platformAccessRouter.createCaller({ serverDB: db, userId: adminId } as any);

    await expect(caller.isPlatformAdmin()).resolves.toBe(false);

    await db.update(users).set({ banned: false }).where(eq(users.id, adminId));
  });
});
