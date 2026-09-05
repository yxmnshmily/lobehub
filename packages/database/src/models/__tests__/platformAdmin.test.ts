// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { permissions, rolePermissions, roles, userRoles, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { bootstrapPlatformAdmin, getActivePlatformAdminCount } from '../platformAdmin';

const db: LobeChatDatabase = await getTestDB();
const userId = 'platform-admin-bootstrap-user';

const cleanup = async () => {
  await db.delete(userRoles);
  await db.delete(rolePermissions);
  await db.delete(roles);
  await db.delete(permissions);
  await db.delete(users);
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values({ id: userId });
  await db.insert(permissions).values({ category: 'test', code: 'test:all', name: 'Test' });
});

afterEach(cleanup);

describe('platform administrator bootstrap', () => {
  it('rejects an unknown explicit user id', async () => {
    await expect(bootstrapPlatformAdmin(db, 'missing-user')).rejects.toThrow('does not exist');
  });

  it('idempotently creates and assigns the global role with all active permissions', async () => {
    await bootstrapPlatformAdmin(db, userId);
    await bootstrapPlatformAdmin(db, userId);

    await expect(getActivePlatformAdminCount(db)).resolves.toBe(1);
    expect(await db.select().from(userRoles)).toHaveLength(1);
    expect(await db.select().from(rolePermissions)).toHaveLength(1);
  });
});
