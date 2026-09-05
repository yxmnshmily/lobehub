// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';

import { composioRouter } from '../composio';

const mocks = vi.hoisted(() => ({
  connectedAccountsDelete: vi.fn(),
  connectedAccountsGet: vi.fn(),
  connectedAccountsLink: vi.fn(),
  connectorCreate: vi.fn(),
  connectorDelete: vi.fn(),
  connectorFindByConnectedAccountId: vi.fn(),
  connectorFindScopedByIdentifier: vi.fn(),
  platformAdminGuard: vi.fn(),
  pluginCreate: vi.fn(),
  pluginDelete: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/config/composio', () => ({ getServerComposioAuthConfigId: () => 'auth-config-1' }));
vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({
    connectedAccounts: {
      delete: mocks.connectedAccountsDelete,
      get: mocks.connectedAccountsGet,
      link: mocks.connectedAccountsLink,
    },
    tools: { getRawComposioTools: vi.fn().mockResolvedValue({ items: [] }) },
  }),
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));
vi.mock('../_helpers/platformAdminGuard', () => ({
  requirePlatformAdmin: (opts: any) => mocks.platformAdminGuard(opts),
}));

const callerFor = (userId: string) =>
  composioRouter.createCaller({ serverDB: {}, userId, workspaceId: null } as any);

describe('composioRouter platform administration boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platformAdminGuard.mockImplementation((opts: any) => {
      if (opts.ctx.userId === 'platform-admin') return opts.next();
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Platform administrator access is required',
      });
    });
    mocks.connectedAccountsLink.mockResolvedValue({
      id: 'account-owned',
      redirectUrl: 'https://auth',
    });
    mocks.connectorCreate.mockResolvedValue({ id: 'connector-1' });
    vi.mocked(ConnectorModel).mockImplementation(
      () =>
        ({
          create: mocks.connectorCreate,
          delete: mocks.connectorDelete,
          findComposioReferenceByConnectedAccountId: mocks.connectorFindByConnectedAccountId,
          findScopedByIdentifier: mocks.connectorFindScopedByIdentifier,
        }) as any,
    );
    vi.mocked(ConnectorToolModel).mockImplementation(
      () => ({ deleteToolsNotIn: vi.fn(), upsertMany: vi.fn() }) as any,
    );
    vi.mocked(PluginModel).mockImplementation(
      () =>
        ({
          create: mocks.pluginCreate,
          delete: mocks.pluginDelete,
          findById: vi.fn(),
          query: vi.fn().mockResolvedValue([]),
        }) as any,
    );
  });

  it.each([
    [
      'create',
      () =>
        callerFor('ordinary-user').createConnection({
          appSlug: 'gmail',
          identifier: 'gmail',
          label: 'Gmail',
        }),
    ],
    [
      'delete',
      () =>
        callerFor('ordinary-user').deleteConnection({
          connectedAccountId: 'account-owned',
          identifier: 'gmail',
        }),
    ],
    [
      'query',
      () => callerFor('ordinary-user').getConnection({ connectedAccountId: 'account-owned' }),
    ],
  ])(
    'rejects an ordinary customer attempting to %s a Composio connection',
    async (_name, invoke) => {
      await expect(invoke()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mocks.connectedAccountsDelete).not.toHaveBeenCalled();
      expect(mocks.connectedAccountsGet).not.toHaveBeenCalled();
      expect(mocks.connectedAccountsLink).not.toHaveBeenCalled();
    },
  );

  it('rejects a different connectedAccountId before any remote delete', async () => {
    mocks.connectorFindScopedByIdentifier.mockResolvedValue({
      id: 'connector-1',
      identifier: 'gmail',
      metadata: { composio: { connectedAccountId: 'account-owned' } },
      userId: 'platform-admin',
    });

    await expect(
      callerFor('platform-admin').deleteConnection({
        connectedAccountId: 'account-other-user',
        identifier: 'gmail',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(mocks.connectedAccountsDelete).not.toHaveBeenCalled();
    expect(mocks.pluginDelete).not.toHaveBeenCalled();
    expect(mocks.connectorDelete).not.toHaveBeenCalled();
  });

  it('rejects an unowned connectedAccountId before querying Composio', async () => {
    mocks.connectorFindByConnectedAccountId.mockResolvedValue(null);

    await expect(
      callerFor('platform-admin').getConnection({ connectedAccountId: 'account-other-user' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(mocks.connectedAccountsGet).not.toHaveBeenCalled();
  });

  it('lets a platform administrator delete the matching owned connection', async () => {
    mocks.connectorFindScopedByIdentifier.mockResolvedValue({
      id: 'connector-1',
      identifier: 'gmail',
      metadata: { composio: { connectedAccountId: 'account-owned' } },
      userId: 'platform-admin',
    });

    await expect(
      callerFor('platform-admin').deleteConnection({
        connectedAccountId: 'account-owned',
        identifier: 'gmail',
      }),
    ).resolves.toEqual({ success: true });

    expect(mocks.connectedAccountsDelete).toHaveBeenCalledWith('account-owned');
    expect(mocks.pluginDelete).toHaveBeenCalledWith('gmail');
    expect(mocks.connectorDelete).toHaveBeenCalledWith('connector-1');
  });
});
