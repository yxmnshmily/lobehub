// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';

import { connectorRouter } from '../connector';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  platformAdminGuard: vi.fn(),
  query: vi.fn(),
  queryAllAgentScoped: vi.fn(),
  queryAllAgentScopedPublic: vi.fn(),
  queryByAgent: vi.fn(),
  queryByAgentPublic: vi.fn(),
  queryPublic: vi.fn(),
  queryTools: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({
    getAgentAvatarsByIds: vi
      .fn()
      .mockResolvedValue([{ avatar: null, id: 'agent-1', name: null, title: 'Agent 1' }]),
  })),
}));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn(() => ({})) }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
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

const publicRow = {
  agentId: null,
  avatar: null,
  createdAt: new Date('2026-09-03T00:00:00.000Z'),
  description: 'Safe description',
  hasCredentials: true,
  id: '11111111-1111-4111-8111-111111111111',
  identifier: 'private-mcp',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example.com',
  name: 'Private MCP',
  sourceType: 'custom',
  status: 'connected',
  updatedAt: new Date('2026-09-03T00:00:00.000Z'),
  userId: 'platform-admin',
};

const callerFor = (userId: string) =>
  connectorRouter.createCaller({ serverDB: {}, userId, workspaceId: null } as any);

describe('connectorRouter credential projections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platformAdminGuard.mockImplementation((opts: any) => {
      if (opts.ctx.userId === 'platform-admin') return opts.next();
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Platform administrator access is required',
      });
    });
    mocks.query.mockRejectedValue(new Error('decrypted connector query must not run'));
    mocks.queryByAgent.mockRejectedValue(new Error('decrypted agent connector query must not run'));
    mocks.queryAllAgentScoped.mockRejectedValue(
      new Error('decrypted aggregate connector query must not run'),
    );
    mocks.queryPublic.mockResolvedValue([publicRow]);
    mocks.queryByAgentPublic.mockResolvedValue([{ ...publicRow, agentId: 'agent-1' }]);
    mocks.queryAllAgentScopedPublic.mockResolvedValue([{ ...publicRow, agentId: 'agent-1' }]);
    mocks.queryTools.mockResolvedValue([]);
    vi.mocked(ConnectorModel).mockImplementation(
      () =>
        ({
          findById: mocks.findById,
          query: mocks.query,
          queryAllAgentScoped: mocks.queryAllAgentScoped,
          queryAllAgentScopedPublic: mocks.queryAllAgentScopedPublic,
          queryByAgent: mocks.queryByAgent,
          queryByAgentPublic: mocks.queryByAgentPublic,
          queryPublic: mocks.queryPublic,
        }) as any,
    );
    vi.mocked(ConnectorToolModel).mockImplementation(
      () => ({ queryByConnector: mocks.queryTools }) as any,
    );
  });

  it('lists base connectors without loading or returning credential-bearing fields', async () => {
    const result = await callerFor('ordinary-user').list();

    expect(result).toEqual([
      expect.objectContaining({
        hasCredentials: true,
        id: publicRow.id,
        metadata: { avatar: null, description: 'Safe description' },
      }),
    ]);
    expect(result[0]).not.toHaveProperty('credentials');
    expect(result[0]).toMatchObject({
      metadata: { avatar: null, description: 'Safe description' },
    });
    expect(JSON.stringify(result[0])).not.toContain('customHeaders');
    expect(result[0]).not.toHaveProperty('oidcConfig');
    expect(result[0]).not.toHaveProperty('userId');
  });

  it('lists agent connectors without loading or returning credential-bearing fields', async () => {
    const [byAgent, aggregate] = await Promise.all([
      callerFor('ordinary-user').listByAgent({ agentId: 'agent-1' }),
      callerFor('ordinary-user').listAgentBound(),
    ]);

    for (const row of [...byAgent, ...aggregate]) {
      expect(row).not.toHaveProperty('credentials');
      expect(row).toMatchObject({
        metadata: { avatar: null, description: 'Safe description' },
      });
      expect(JSON.stringify(row)).not.toContain('customHeaders');
      expect(row).not.toHaveProperty('oidcConfig');
      expect(row).not.toHaveProperty('userId');
    }
  });

  it('rejects an ordinary customer before decrypting connector edit credentials', async () => {
    mocks.findById.mockResolvedValue({
      ...publicRow,
      credentials: { token: 'must-not-leak', type: 'bearer' },
      metadata: {},
      oidcConfig: null,
    });

    await expect(callerFor('ordinary-user').getForEdit({ id: publicRow.id })).rejects.toMatchObject(
      {
        code: 'FORBIDDEN',
      },
    );
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('keeps credential edit access available to a platform administrator', async () => {
    mocks.findById.mockResolvedValue({
      ...publicRow,
      credentials: { token: 'admin-edit-token', type: 'bearer' },
      metadata: {},
      oidcConfig: null,
    });

    await expect(
      callerFor('platform-admin').getForEdit({ id: publicRow.id }),
    ).resolves.toMatchObject({
      credentials: { token: 'admin-edit-token', type: 'bearer' },
    });
  });
});
