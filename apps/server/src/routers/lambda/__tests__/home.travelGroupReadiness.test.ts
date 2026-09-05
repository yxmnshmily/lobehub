// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { homeRouter } from '../home';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  ensure: vi.fn(),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: mod.trpc.procedure };
});

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/repositories/agentMigration', () => ({ AgentMigrationRepo: vi.fn() }));
vi.mock('@/database/repositories/home', () => ({ HomeRepository: vi.fn() }));
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: (opts: any) => opts.next({ ctx: opts.ctx }),
}));
vi.mock('@/server/services/home', () => ({ HomeService: vi.fn() }));
vi.mock('@/server/services/user', () => ({
  UserService: vi.fn(() => ({
    checkTravelServiceReadiness: mocks.check,
    ensureTravelServiceReady: mocks.ensure,
  })),
}));
vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: vi.fn(),
}));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: vi.fn() }));

const caller = (userId: string) =>
  homeRouter.createCaller({ serverDB: {}, userId, workspaceId: null } as any);

describe('home travel-group readiness contracts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('derives readiness only from ctx.userId and rejects forged ownership input', async () => {
    mocks.check.mockResolvedValue({ groupId: null, status: 'preparing' });

    await expect(caller('user-a').getMyTravelGroupReadiness()).resolves.toEqual({
      status: 'preparing',
    });
    expect(mocks.check).toHaveBeenCalledWith('user-a');
    await expect(
      caller('user-a').getMyTravelGroupReadiness({ targetUserId: 'user-b' } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('returns groupId only for a ready group owned by the current user', async () => {
    mocks.check.mockImplementation(async (userId: string) => ({
      groupId: `group-${userId.slice(-1)}`,
      status: 'ready',
    }));

    await expect(caller('user-a').getMyTravelGroupReadiness()).resolves.toEqual({
      groupId: 'group-a',
      status: 'ready',
    });
  });

  it('coalesces retry double-clicks per user and never mixes different users', async () => {
    const releases = new Map<string, () => void>();
    mocks.check.mockImplementation(async (userId: string) => ({
      groupId: `group-${userId.slice(-1)}`,
      status: 'ready',
    }));
    mocks.ensure.mockImplementation(
      (userId: string) => new Promise<void>((resolve) => releases.set(userId, resolve)),
    );

    const first = caller('user-a').ensureMyTravelServiceReady();
    const second = caller('user-a').ensureMyTravelServiceReady();
    const other = caller('user-b').ensureMyTravelServiceReady();

    await vi.waitFor(() => expect(mocks.ensure).toHaveBeenCalledTimes(2));
    expect(mocks.ensure).toHaveBeenNthCalledWith(1, 'user-a');
    expect(mocks.ensure).toHaveBeenNthCalledWith(2, 'user-b');
    releases.forEach((release) => release());

    await expect(Promise.all([first, second, other])).resolves.toEqual([
      { groupId: 'group-a', status: 'ready' },
      { groupId: 'group-a', status: 'ready' },
      { groupId: 'group-b', status: 'ready' },
    ]);
  });

  it('does not turn review-required state into an automatic repair', async () => {
    mocks.check.mockResolvedValue({ groupId: null, status: 'review_required' });

    await expect(caller('user-a').getMyTravelGroupReadiness()).resolves.toEqual({
      status: 'review_required',
    });
    expect(mocks.ensure).not.toHaveBeenCalled();
  });
});
