import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { accessState, mockFindUser, mockGetServerDB, mockHasAnyPermission, mockHasGlobalRole } =
  vi.hoisted(() => ({
    accessState: { banned: false, globalRole: false },
    mockFindUser: vi.fn(),
    mockGetServerDB: vi.fn(),
    mockHasAnyPermission: vi.fn(),
    mockHasGlobalRole: vi.fn(),
  }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = mockHasAnyPermission;
    hasGlobalRole = mockHasGlobalRole;
  },
}));

vi.mock('../common/validator', () => ({
  zValidator: () => async (_c: any, next: any) => next(),
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));

vi.mock('../middleware/workspace', () => ({
  requireWorkspaceRoleWhenScoped: () => async (_c: any, next: any) => next(),
}));

vi.mock('../controllers', () => ({
  ModelController: class {
    handleCreateModel(c: any) {
      return c.json({ ok: true });
    }

    handleGetModel(c: any) {
      return c.json({ ok: true });
    }

    handleGetModels(c: any) {
      return c.json({ ok: true });
    }

    handleUpdateModel(c: any) {
      return c.json({ ok: true });
    }
  },
}));

vi.mock('../controllers/provider.controller', () => ({
  ProviderController: class {
    handleCreateProvider(c: any) {
      return c.json({ ok: true });
    }

    handleDeleteProvider(c: any) {
      return c.json({ ok: true });
    }

    handleGetProvider(c: any) {
      return c.json({ ok: true });
    }

    handleGetProviders(c: any) {
      return c.json({ ok: true });
    }

    handleUpdateProvider(c: any) {
      return c.json({ ok: true });
    }
  },
}));

vi.mock('../controllers/api-key.controller', () => ({
  ApiKeyController: class {
    createApiKey(c: any) {
      return c.json({ ok: true });
    }

    deleteApiKey(c: any) {
      return c.json({ ok: true });
    }

    getApiKey(c: any) {
      return c.json({ ok: true });
    }

    getApiKeys(c: any) {
      return c.json({ ok: true });
    }

    updateApiKey(c: any) {
      return c.json({ ok: true });
    }
  },
}));

vi.mock('../controllers/agent-group.controller', () => ({
  AgentGroupController: class {
    createAgentGroup(c: any) {
      return c.json({ ok: true });
    }

    deleteAgentGroup(c: any) {
      return c.json({ ok: true });
    }

    getAgentGroupById(c: any) {
      return c.json({ ok: true });
    }

    getAgentGroups(c: any) {
      return c.json({ ok: true });
    }

    updateAgentGroup(c: any) {
      return c.json({ ok: true });
    }
  },
}));

const [
  { default: ProviderRoutes },
  { default: ApiKeyRoutes },
  { default: ModelRoutes },
  { default: AgentGroupRoutes },
] = await Promise.all([
  import('./providers.route'),
  import('./api-keys.route'),
  import('./models.route'),
  import('./agent-groups.route'),
]);

type Access = {
  banned: boolean;
  globalRole: boolean;
  userId?: string;
  workspaceRole?: string;
};

const routes = {
  'agent-groups': AgentGroupRoutes,
  'api-keys': ApiKeyRoutes,
  'models': ModelRoutes,
  'providers': ProviderRoutes,
} as const;

const protectedOperations = [
  ['providers', 'GET', '/'],
  ['providers', 'GET', '/provider-1'],
  ['providers', 'POST', '/'],
  ['providers', 'PATCH', '/provider-1'],
  ['providers', 'DELETE', '/provider-1'],
  ['api-keys', 'GET', '/'],
  ['api-keys', 'GET', '/key-1'],
  ['api-keys', 'POST', '/'],
  ['api-keys', 'PATCH', '/key-1'],
  ['api-keys', 'DELETE', '/key-1'],
  ['models', 'POST', '/'],
  ['models', 'PATCH', '/provider-1/model-1'],
  ['agent-groups', 'POST', '/'],
  ['agent-groups', 'PATCH', '/group-1'],
  ['agent-groups', 'DELETE', '/group-1'],
] as const;

const readOnlyCatalogOperations = [
  ['models', 'GET', '/'],
  ['models', 'GET', '/provider-1/model-1'],
  ['agent-groups', 'GET', '/'],
  ['agent-groups', 'GET', '/group-1'],
] as const;

const requestAs = async (
  routeName: keyof typeof routes,
  method: string,
  path: string,
  access: Access,
) => {
  accessState.banned = access.banned;
  accessState.globalRole = access.globalRole;

  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, (access.userId ?? 'user-1') as never);
    c.set('workspaceId' as never, (access.workspaceRole ? 'workspace-1' : undefined) as never);
    c.set('workspaceRole' as never, access.workspaceRole as never);
    await next();
  });
  app.route('/', routes[routeName]);

  return app.request(path, { method });
};

describe('OpenAPI platform administrator route gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUser.mockImplementation(async () => ({ banned: accessState.banned, id: 'user-1' }));
    mockGetServerDB.mockResolvedValue({
      query: { users: { findFirst: mockFindUser } },
    });
    mockHasAnyPermission.mockResolvedValue(true);
    mockHasGlobalRole.mockImplementation(async () => accessState.globalRole);
  });

  it.each(protectedOperations)(
    'rejects an ordinary user from %s %s %s',
    async (routeName, method, path) => {
      const response = await requestAs(routeName, method, path, {
        banned: false,
        globalRole: false,
      });

      expect(response.status).toBe(403);
      expect(mockHasGlobalRole).toHaveBeenCalledWith('super_admin');
    },
  );

  it.each(protectedOperations)(
    'does not treat a workspace admin as a platform admin for %s %s %s',
    async (routeName, method, path) => {
      const response = await requestAs(routeName, method, path, {
        banned: false,
        globalRole: false,
        workspaceRole: 'admin',
      });

      expect(response.status).toBe(403);
      expect(mockHasGlobalRole).toHaveBeenCalledWith('super_admin');
    },
  );

  it.each(protectedOperations)(
    'rejects a banned global super_admin from %s %s %s',
    async (routeName, method, path) => {
      const response = await requestAs(routeName, method, path, {
        banned: true,
        globalRole: true,
      });

      expect(response.status).toBe(403);
      expect(mockHasGlobalRole).not.toHaveBeenCalled();
    },
  );

  it.each(protectedOperations)(
    'allows an active global super_admin to use %s %s %s',
    async (routeName, method, path) => {
      const response = await requestAs(routeName, method, path, {
        banned: false,
        globalRole: true,
      });

      expect(response.status).toBe(200);
      expect(mockHasGlobalRole).toHaveBeenCalledWith('super_admin');
    },
  );

  it.each(readOnlyCatalogOperations)(
    'keeps the generation catalog readable for an ordinary authorized user: %s %s %s',
    async (routeName, method, path) => {
      const response = await requestAs(routeName, method, path, {
        banned: false,
        globalRole: false,
      });

      expect(response.status).toBe(200);
    },
  );
});
