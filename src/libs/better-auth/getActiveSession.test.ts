import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveSession } from './getActiveSession';

const mocks = vi.hoisted(() => ({
  assertUserActive: vi.fn(),
  getServerDB: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));
vi.mock('@/libs/oidc-provider/access-control', () => ({
  assertOIDCUserActive: mocks.assertUserActive,
}));

describe('getActiveSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDB.mockResolvedValue({});
    mocks.assertUserActive.mockResolvedValue(undefined);
    mocks.getSession.mockResolvedValue({
      session: { token: 'server-session-token' },
      user: { id: 'active-user', name: 'Active User' },
    });
  });

  it('returns a session only after its current database user is active', async () => {
    const session = await getActiveSession(
      new Headers({ cookie: 'better-auth.session_data=cached-user' }),
    );

    expect(session?.user.id).toBe('active-user');
  });

  it('fails closed without exposing the reason when the current user is inactive', async () => {
    mocks.assertUserActive.mockRejectedValueOnce(
      new Error('private account status and reason must not escape'),
    );

    const session = await getActiveSession(
      new Headers({ authorization: 'Bearer server-session-token' }),
    );

    expect(session).toBeNull();
  });

  it('fails closed when a cached session points at a deleted user', async () => {
    mocks.assertUserActive.mockRejectedValueOnce(new Error('missing user'));

    const session = await getActiveSession(
      new Headers({ cookie: 'better-auth.session_data=stale' }),
    );

    expect(session).toBeNull();
  });

  it('does not accept a session when current account lookup fails', async () => {
    mocks.getServerDB.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(getActiveSession(new Headers())).resolves.toBeNull();
  });
});
