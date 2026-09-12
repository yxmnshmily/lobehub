// @vitest-environment node
import { roles, userRoles, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { platformOperationsRouter } from '../platformOperations';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));
const db = await getTestDB();
const adminId = 'super-template-route-admin';
const userId = 'super-template-route-user';
const caller = (id: string) =>
  platformOperationsRouter.createCaller({ serverDB: db, userId: id } as any);

beforeAll(async () => {
  await db.insert(users).values([
    { id: adminId, emailVerified: true },
    { id: userId, emailVerified: true },
  ]);
  await db
    .insert(roles)
    .values({ name: 'super_admin', displayName: 'Super Admin', isActive: true })
    .onConflictDoNothing();
  const role = await db.query.roles.findFirst({ where: eq(roles.name, 'super_admin') });
  await db.insert(userRoles).values({ roleId: role!.id, userId: adminId });
});
afterAll(async () => {
  await db.delete(users);
});

describe('super-group template management routes', () => {
  it('allows only active platform administrators to view and update the shared template', async () => {
    await expect(caller(userId).getSuperGroupTemplate()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const result = await caller(adminId).upsertSuperGroupTemplateMember({
      title: '四川策划',
      description: '四川旅游规划',
      systemRole: '规划真实四川行程。',
    });
    expect(result).toMatchObject({
      revision: 1,
      syncedGroupCount: 1,
      member: { title: '四川策划' },
    });
    expect(
      (await caller(adminId).getSuperGroupTemplate()).members.some(
        ({ key }) => key === result.member.key,
      ),
    ).toBe(true);
    await db.update(users).set({ banned: true }).where(eq(users.id, adminId));
    await expect(caller(adminId).getSuperGroupTemplate()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
