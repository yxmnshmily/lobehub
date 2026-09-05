// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { permissions, rolePermissions, roles, userRoles, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type { UpdateUserRequest } from '../types/user.type';
import { UserService } from './user.service';

vi.mock('@/config/db', () => ({ serverDBEnv: {} }));
vi.mock('@/database/models/user', () => ({ UserModel: class {} }));

const { getTestDB } = await import('@/database/core/getTestDB');
const db: LobeChatDatabase = await getTestDB();
const adminId = 'openapi-user-update-admin';
const customerId = 'openapi-user-update-customer';
const userIds = [adminId, customerId];

let customerRoleId: string;
let superAdminRoleId: string;

const ensureRole = async (name: string, displayName: string) => {
  await db
    .insert(roles)
    .values({ displayName, isActive: true, isSystem: true, name, workspaceId: null })
    .onConflictDoNothing();

  const role = await db.query.roles.findFirst({ where: eq(roles.name, name) });
  if (!role) throw new Error(`Missing ${name} role in test setup`);
  return role;
};

const cleanupUsers = async () => {
  await db.delete(userRoles).where(inArray(userRoles.userId, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
};

beforeEach(async () => {
  await cleanupUsers();
  await db.insert(users).values([
    { email: 'openapi-admin@example.com', fullName: 'OpenAPI Admin', id: adminId },
    { email: 'openapi-customer@example.com', fullName: 'OpenAPI Customer', id: customerId },
  ]);

  const superAdminRole = await ensureRole('super_admin', 'Super Admin');
  const customerRole = await ensureRole('openapi_customer', 'OpenAPI Customer');
  superAdminRoleId = superAdminRole.id;
  customerRoleId = customerRole.id;

  const permissionCode = 'rbac:user_role_update:all';
  await db
    .insert(permissions)
    .values({ category: 'rbac', code: permissionCode, isActive: true, name: permissionCode })
    .onConflictDoNothing();
  const permission = await db.query.permissions.findFirst({
    where: eq(permissions.code, permissionCode),
  });
  if (!permission) throw new Error('Missing role-update permission in test setup');

  await db
    .insert(rolePermissions)
    .values({ permissionId: permission.id, roleId: superAdminRoleId })
    .onConflictDoNothing();
  await db.insert(userRoles).values([
    { roleId: superAdminRoleId, userId: adminId, workspaceId: null },
    { roleId: customerRoleId, userId: customerId, workspaceId: null },
  ]);
});

afterEach(cleanupUsers);

describe('UserService role mutation boundary', () => {
  it('does not change roles when an ordinary profile update contains a runtime roleIds field', async () => {
    const service = new UserService(db, customerId);
    const maliciousPayload = {
      fullName: 'Updated Customer',
      roleIds: [superAdminRoleId],
    } as UpdateUserRequest & { roleIds: string[] };

    await service.updateUser(customerId, maliciousPayload);

    const assignments = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, customerId));
    const updatedUser = await db.query.users.findFirst({ where: eq(users.id, customerId) });

    expect(assignments.map(({ roleId }) => roleId)).toEqual([customerRoleId]);
    expect(updatedUser?.fullName).toBe('Updated Customer');
  });

  it('allows an authorized administrator to update roles through the dedicated service method', async () => {
    const service = new UserService(db, adminId);

    await service.updateUserRoles(customerId, {
      addRoles: [{ roleId: superAdminRoleId }],
    });

    const assignments = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, customerId));

    expect(assignments.map(({ roleId }) => roleId).sort()).toEqual(
      [customerRoleId, superAdminRoleId].sort(),
    );
  });
});
