// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platformAdminGuard: vi.fn(),
  register: vi.fn(),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRole: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
    wsProcedure: mod.trpc.procedure,
  };
});

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn(() => ({
    register: mocks.register,
  })),
  WorkspaceDevicePrivateConflictError: class WorkspaceDevicePrivateConflictError extends Error {},
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: (opts: any) => opts.next({ ctx: { ...opts.ctx, serverDB: {} } }),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {},
}));

vi.mock('../_helpers/platformAdminGuard', () => ({
  requirePlatformAdmin: (opts: any) => mocks.platformAdminGuard(opts),
}));

const { deviceRouter } = await import('../device');

describe('deviceRouter platform administration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platformAdminGuard.mockImplementation((opts: any) => opts.next());
    mocks.register.mockResolvedValue({ id: 'device-1' });
  });

  it('rejects device-pool writes from an ordinary customer', async () => {
    mocks.platformAdminGuard.mockRejectedValueOnce(
      new TRPCError({ code: 'FORBIDDEN', message: 'Platform administrator access is required' }),
    );

    await expect(
      deviceRouter.createCaller({ userId: 'customer-1' } as any).register({
        deviceId: 'device-1',
        hostname: 'customer-mac',
        identitySource: 'machine-id',
        platform: 'darwin',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
