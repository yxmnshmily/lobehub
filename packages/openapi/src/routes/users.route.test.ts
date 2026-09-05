import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasAnyPermission: vi.fn(),
  updateUser: vi.fn(),
  updateUserRoles: vi.fn(),
}));

// the route module pulls in the db graph (via `requirePermission`) and the
// better-auth graph (via `requireAuth`) at import time; this test is only
// about which gates the route itself declares
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = mocks.hasAnyPermission;
  },
}));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));
vi.mock('../controllers', () => ({
  UserController: class {
    getCurrentUser(c: any) {
      return c.json({ data: { id: 'user-1' }, success: true });
    }

    updateUser(c: any) {
      const body = c.req.valid('json');
      mocks.updateUser(body);
      return c.json({ data: body, success: true });
    }

    updateUserRoles(c: any) {
      const body = c.req.valid('json');
      mocks.updateUserRoles(body);
      return c.json({ data: body, success: true });
    }
  },
}));

const { default: UserRoutes } = await import('./users.route');

const requestAsUser = (path: string, init?: RequestInit) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('userId' as never, 'user-1' as never);
    c.set('authType' as never, 'oidc' as never);
    c.set('apiKeyScopes' as never, undefined as never);
    await next();
  });
  app.route('/', UserRoutes);

  return app.request(path, init);
};

beforeEach(() => {
  mocks.hasAnyPermission.mockReset();
  mocks.hasAnyPermission.mockResolvedValue(true);
  mocks.updateUser.mockReset();
  mocks.updateUserRoles.mockReset();
});

/**
 * A key minted with narrow scopes still has to be able to identify itself, or
 * `lh login` cannot resolve a userId from it. Guarding this route on
 * `user:read` stranded such keys outside the product.
 */
describe('GET /users/me', () => {
  const requestAs = (apiKeyScopes: string[]) => {
    const app = new Hono();

    app.use('*', async (c, next) => {
      c.set('userId' as never, 'user-1' as never);
      c.set('authType' as never, 'apikey' as never);
      c.set('apiKeyScopes' as never, apiKeyScopes as never);
      await next();
    });
    app.route('/', UserRoutes);

    return app.request('/me');
  };

  it('is reachable by a restricted API key that holds no user scope', async () => {
    const res = await requestAs(['agent:read']);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ data: { id: 'user-1' } });
  });

  it('is reachable by a key holding unrelated scopes only', async () => {
    const res = await requestAs(['model:invoke']);

    expect(res.status).toBe(200);
  });
});

describe('user update role boundary', () => {
  it('rejects roleIds on the general profile PATCH before the handler can change roles', async () => {
    const res = await requestAsUser('/user-1', {
      body: JSON.stringify({ roleIds: ['super-admin-role'] }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    });

    expect(res.status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('still accepts ordinary profile fields on the general PATCH', async () => {
    const res = await requestAsUser('/user-1', {
      body: JSON.stringify({
        avatar: 'https://example.com/avatar.png',
        fullName: 'Updated Traveller',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    });

    expect(res.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith({
      avatar: 'https://example.com/avatar.png',
      fullName: 'Updated Traveller',
    });
  });

  it('denies the dedicated role PATCH when the caller lacks role-update permission', async () => {
    mocks.hasAnyPermission.mockResolvedValue(false);

    const res = await requestAsUser('/user-1/roles', {
      body: JSON.stringify({ addRoles: [{ roleId: 'super-admin-role' }] }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    });

    expect(res.status).toBe(403);
    expect(mocks.hasAnyPermission).toHaveBeenCalledWith(['rbac:user_role_update:all'], {
      userId: 'user-1',
      workspaceId: undefined,
    });
    expect(mocks.updateUserRoles).not.toHaveBeenCalled();
  });

  it('allows the dedicated role PATCH when the caller has role-update permission', async () => {
    const res = await requestAsUser('/user-1/roles', {
      body: JSON.stringify({ addRoles: [{ roleId: 'customer-role' }] }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    });

    expect(res.status).toBe(200);
    expect(mocks.hasAnyPermission).toHaveBeenCalledWith(['rbac:user_role_update:all'], {
      userId: 'user-1',
      workspaceId: undefined,
    });
    expect(mocks.updateUserRoles).toHaveBeenCalledWith({
      addRoles: [{ roleId: 'customer-role' }],
    });
  });
});
