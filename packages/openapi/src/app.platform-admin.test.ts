import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { accessState, mockBuildSpecDocument, mockFindUser, mockGetServerDB, mockHasGlobalRole } =
  vi.hoisted(() => ({
    accessState: {
      banned: false,
      globalRole: false,
      userId: null as string | null,
      workspaceRole: undefined as string | undefined,
    },
    mockBuildSpecDocument: vi.fn(),
    mockFindUser: vi.fn(),
    mockGetServerDB: vi.fn(),
    mockHasGlobalRole: vi.fn(),
  }));

vi.mock('@scalar/hono-api-reference', () => ({
  Scalar: () => (c: any) => c.html('<html>API documentation</html>'),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasGlobalRole = mockHasGlobalRole;
  },
}));

vi.mock('./middleware/auth', () => ({
  requireAuth: async (c: any, next: any) => {
    if (!c.get('userId')) throw new HTTPException(401, { message: 'Authentication required' });
    return next();
  },
  userAuthMiddleware: async (c: any, next: any) => {
    c.set('userId', accessState.userId);
    return next();
  },
}));

vi.mock('./middleware/workspace', () => ({
  workspaceAuthMiddleware: async (c: any, next: any) => {
    c.set('workspaceRole', accessState.workspaceRole);
    return next();
  },
}));

vi.mock('./routes', () => ({ default: {} }));

vi.mock('./spec', () => ({
  buildSpecDocument: mockBuildSpecDocument,
}));

const { honoApp } = await import('./app');

type Access = {
  banned: boolean;
  globalRole: boolean;
  userId: string | null;
  workspaceRole?: string;
};

const protectedDocsEndpoints = ['/api/v1/openapi.json', '/api/v1/docs'] as const;

const requestAs = (path: string, access: Access) => {
  accessState.banned = access.banned;
  accessState.globalRole = access.globalRole;
  accessState.userId = access.userId;
  accessState.workspaceRole = access.workspaceRole;

  return honoApp.request(path);
};

describe('OpenAPI documentation platform administrator gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildSpecDocument.mockResolvedValue({ info: { title: 'LobeHub API' }, openapi: '3.1.0' });
    mockFindUser.mockImplementation(async () => ({
      banned: accessState.banned,
      id: accessState.userId,
    }));
    mockGetServerDB.mockResolvedValue({ query: { users: { findFirst: mockFindUser } } });
    mockHasGlobalRole.mockImplementation(async () => accessState.globalRole);
  });

  it.each(protectedDocsEndpoints)('rejects anonymous access to %s', async (path) => {
    const response = await requestAs(path, { banned: false, globalRole: false, userId: null });

    expect(response.status).toBe(401);
    expect(mockGetServerDB).not.toHaveBeenCalled();
  });

  it.each(protectedDocsEndpoints)('rejects an ordinary user from %s', async (path) => {
    const response = await requestAs(path, {
      banned: false,
      globalRole: false,
      userId: 'ordinary-user',
    });

    expect(response.status).toBe(403);
  });

  it.each(protectedDocsEndpoints)('rejects a workspace admin from %s', async (path) => {
    const response = await requestAs(path, {
      banned: false,
      globalRole: false,
      userId: 'workspace-admin',
      workspaceRole: 'admin',
    });

    expect(response.status).toBe(403);
  });

  it.each(protectedDocsEndpoints)('rejects a banned global super_admin from %s', async (path) => {
    const response = await requestAs(path, {
      banned: true,
      globalRole: true,
      userId: 'banned-super-admin',
    });

    expect(response.status).toBe(403);
  });

  it.each(protectedDocsEndpoints)(
    'allows an active global super_admin to access %s',
    async (path) => {
      const response = await requestAs(path, {
        banned: false,
        globalRole: true,
        userId: 'active-super-admin',
      });

      expect(response.status).toBe(200);
    },
  );

  it('keeps the health endpoint public', async () => {
    const response = await requestAs('/api/v1/health', {
      banned: false,
      globalRole: false,
      userId: null,
    });

    expect(response.status).toBe(200);
    expect(mockGetServerDB).not.toHaveBeenCalled();
  });
});
