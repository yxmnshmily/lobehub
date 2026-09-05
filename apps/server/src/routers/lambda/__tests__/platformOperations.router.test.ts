// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { PlatformUserContentModel } from '@/database/models/platformUserContent';
import { PlatformUserOperationsModel } from '@/database/models/platformUserOperations';
import { UserModel } from '@/database/models/user';
import {
  account as authAccounts,
  agents,
  chatGroups,
  chatGroupsAgents,
  documents,
  platformAdminOperationAudits,
  platformCreditAccounts,
  roles,
  session as authSessions,
  travelGenerationTasks,
  travelServiceAccounts,
  userRoles,
  users,
  works,
  workspaces,
} from '@/database/schemas';
import {
  PLATFORM_AUTH_REVOCATION_RETRY_MESSAGE,
  PlatformAuthRevocationError,
} from '@/server/services/platformAuthRevocation';
import {
  PLATFORM_USER_ACCOUNT_ADMIN_RETRY_MESSAGE,
  PlatformUserAccountAdministrationError,
} from '@/server/services/platformUserAccountAdministration';
import * as travelServiceGroup from '@/server/services/user/travelServiceGroup';

import { platformOperationsRouter } from '../platformOperations';

const mocks = vi.hoisted(() => ({
  forcePasswordReset: vi.fn(),
  revokeUser: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('@/server/services/platformAuthRevocation', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    PlatformAuthRevocationService: class {
      revokeUser = mocks.revokeUser;
    },
  };
});

vi.mock('@/server/services/platformUserAccountAdministration', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    PlatformUserAccountAdministrationService: class {
      forcePasswordReset = mocks.forcePasswordReset;
      updateProfile = mocks.updateProfile;
    },
  };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

const db = await getTestDB();
const adminId = 'platform-operations-route-admin';
const standardAdminId = 'platform-operations-route-standard-admin';
const deletedAdminId = 'platform-operations-route-deleted-admin';
const ordinaryId = 'platform-operations-route-ordinary';
const targetId = 'platform-operations-route-target';
const targetGroupId = 'platform-operations-route-group';
const targetPublicGroupId = 'platform-operations-route-public-group';
const targetTeamGroupId = 'platform-operations-route-team-group';
const targetWorkspaceId = 'platform-operations-route-workspace';
const auditTargetId = 'platform-operations-route-audit-target';

const adminCaller = () =>
  platformOperationsRouter.createCaller({ serverDB: db, userId: adminId } as any);
const ordinaryCaller = () =>
  platformOperationsRouter.createCaller({ serverDB: db, userId: ordinaryId } as any);
const standardAdminCaller = () =>
  platformOperationsRouter.createCaller({ serverDB: db, userId: standardAdminId } as any);
const deletedAdminCaller = () =>
  platformOperationsRouter.createCaller({ serverDB: db, userId: deletedAdminId } as any);

const healthyTravelGroupHealth = {
  groupCount: 1,
  healthy: true,
  isPrivate: true,
  issueCodes: [],
  requiredMembers: {
    'copywriter': { enabled: true, exists: true, platformManaged: true },
    'designer': { enabled: true, exists: true, platformManaged: true },
    'document-assistant': { enabled: true, exists: true, platformManaged: true },
    'video-producer': { enabled: true, exists: true, platformManaged: true },
  },
  supervisor: { count: 1, platformManaged: true, titleMatches: true },
} as const;

const safeTravelGroupRepairHealth = {
  ...healthyTravelGroupHealth,
  healthy: false,
  isPrivate: false,
  issueCodes: ['DEFAULT_GROUP_NOT_PRIVATE'],
} as const;

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

beforeAll(async () => {
  await db.insert(users).values([
    { email: 'platform-operations-admin@example.com', id: adminId },
    { email: 'platform-operations-standard-admin@example.com', id: standardAdminId },
    { email: 'platform-operations-ordinary@example.com', id: ordinaryId },
    {
      avatar: 'https://example.com/customer.png',
      email: 'platform-operations-customer@example.com',
      emailVerified: true,
      fullName: '西藏旅行客户',
      id: targetId,
      username: 'tibet-customer',
    },
  ]);
  await db.insert(platformAdminOperationAudits).values([
    {
      action: 'user.profile_updated',
      occurredAt: new Date('2026-09-02T10:00:00.000Z'),
      operationId: 'platform-operations-route-audit-profile-requested',
      operatorUserId: adminId,
      phase: 'requested',
      targetUserId: auditTargetId,
    },
    {
      action: 'user.profile_updated',
      occurredAt: new Date('2026-09-02T11:00:00.000Z'),
      operationId: 'platform-operations-route-audit-profile-succeeded',
      operatorUserId: adminId,
      phase: 'succeeded',
      targetUserId: auditTargetId,
    },
    {
      action: 'user.profile_updated',
      occurredAt: new Date('2026-09-02T12:00:00.000Z'),
      operationId: 'platform-operations-route-audit-profile-failed',
      operatorUserId: adminId,
      phase: 'failed',
      targetUserId: auditTargetId,
    },
    {
      action: 'user.banned',
      occurredAt: new Date('2026-09-02T13:00:00.000Z'),
      operationId: 'platform-operations-route-audit-ban',
      operatorUserId: adminId,
      phase: 'succeeded',
      targetUserId: auditTargetId,
    },
  ]);
  await db
    .insert(roles)
    .values({ displayName: 'Super Admin', isActive: true, isSystem: true, name: 'super_admin' })
    .onConflictDoNothing();
  const role = await db.query.roles.findFirst({ where: eq(roles.name, 'super_admin') });
  if (!role) throw new Error('Missing super_admin role in test setup');
  await db.insert(userRoles).values({ roleId: role.id, userId: adminId, workspaceId: null });
  await db
    .insert(roles)
    .values({ displayName: 'Admin', isActive: true, isSystem: true, name: 'admin' })
    .onConflictDoNothing();
  const standardAdminRole = await db.query.roles.findFirst({ where: eq(roles.name, 'admin') });
  if (!standardAdminRole) throw new Error('Missing admin role in test setup');
  await db
    .insert(userRoles)
    .values({ roleId: standardAdminRole.id, userId: standardAdminId, workspaceId: null });

  await db.insert(authAccounts).values({
    accountId: 'platform-operations-route-account',
    id: 'platform-operations-route-account-row',
    password: 'ROUTE_PASSWORD_HASH_MUST_NOT_LEAK',
    providerId: 'credential',
    userId: targetId,
  });
  await db.insert(travelServiceAccounts).values({
    balanceFen: 1234,
    userId: targetId,
    userIdSnapshot: targetId,
  });

  await db.insert(workspaces).values({
    id: targetWorkspaceId,
    name: 'Platform operations route team',
    primaryOwnerId: targetId,
    slug: targetWorkspaceId,
  });

  await db.insert(agents).values({
    agencyConfig: { apiKey: 'ROUTE_MODEL_KEY_MUST_NOT_LEAK' } as any,
    clientId: 'platform-operations-route-supervisor',
    id: 'platform-operations-route-agent',
    slug: 'platform-operations-route-agent',
    title: '旅游群主AI',
    userId: targetId,
  });
  await db.insert(chatGroups).values({
    clientId: 'default-travel-service-group',
    config: {
      memberSlots: [
        {
          agentId: 'platform-operations-route-agent',
          configurable: true,
          key: 'owner',
          label: '旅游群主AI',
          role: 'supervisor',
          status: 'configured',
        },
      ],
      systemPrompt: 'ROUTE_GROUP_CONFIG_MUST_NOT_LEAK',
    },
    content: 'ROUTE_GROUP_PROMPT_MUST_NOT_LEAK',
    id: targetGroupId,
    title: '旅游服务超级群组',
    userId: targetId,
    visibility: 'private',
  });
  await db.insert(chatGroups).values([
    {
      clientId: targetPublicGroupId,
      id: targetPublicGroupId,
      title: 'Public group must remain hidden',
      userId: targetId,
      visibility: 'public',
    },
    {
      clientId: targetTeamGroupId,
      id: targetTeamGroupId,
      title: 'Team group must remain hidden',
      userId: targetId,
      visibility: 'private',
      workspaceId: targetWorkspaceId,
    },
  ]);
  await db.insert(chatGroupsAgents).values({
    agentId: 'platform-operations-route-agent',
    chatGroupId: targetGroupId,
    enabled: true,
    role: 'supervisor',
    userId: targetId,
  });
  await db.insert(travelGenerationTasks).values({
    groupId: targetGroupId,
    id: 'platform-operations-route-generation',
    input: { prompt: 'ROUTE_GENERATION_PROMPT_MUST_NOT_LEAK' },
    message: 'ROUTE_GENERATION_MESSAGE_MUST_NOT_LEAK',
    provider: 'ROUTE_PROVIDER_MUST_NOT_LEAK',
    status: 'succeeded',
    type: 'copy',
    userId: targetId,
  });
  await db.insert(works).values({
    description: 'ROUTE_WORK_BODY_MUST_NOT_LEAK',
    id: 'platform-operations-route-work',
    resourceType: 'document',
    status: 'completed',
    title: '西藏旅游文案',
    toolIdentifier: 'lobe-agent-documents',
    toolName: 'createDocument',
    type: 'document',
    url: 'https://private.example/ROUTE_WORK_URL_MUST_NOT_LEAK',
    userId: targetId,
    visibility: 'private',
  });
  await db.insert(documents).values({
    content: 'ROUTE_DOCUMENT_BODY_MUST_NOT_LEAK',
    fileType: 'text/markdown',
    id: 'platform-operations-route-document',
    metadata: { key: 'ROUTE_DOCUMENT_METADATA_MUST_NOT_LEAK' },
    source: '/private/ROUTE_DOCUMENT_SOURCE_MUST_NOT_LEAK',
    sourceType: 'agent',
    title: '旅游文案文稿',
    totalCharCount: 100,
    totalLineCount: 8,
    userId: targetId,
    visibility: 'private',
  });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  mocks.forcePasswordReset.mockReset().mockResolvedValue({
    id: targetId,
    resetRequested: true,
  });
  mocks.revokeUser.mockReset().mockResolvedValue(undefined);
  mocks.updateProfile.mockReset().mockResolvedValue({
    avatar: 'https://example.com/customer-updated.png',
    fullName: '西藏旅行客户·更新',
    id: targetId,
  });
  await db
    .update(users)
    .set({ banExpires: null, banned: false, banReason: null })
    .where(eq(users.id, targetId));
  await db
    .update(users)
    .set({ banExpires: null, banned: false, banReason: null })
    .where(eq(users.id, adminId));
  await db.delete(authSessions).where(eq(authSessions.userId, targetId));
  await db.delete(authSessions).where(eq(authSessions.userId, ordinaryId));
  await db.insert(authSessions).values([
    {
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
      expiresAt: new Date('2027-09-02T00:00:00.000Z'),
      id: 'platform-operations-route-session-c',
      ipAddress: '192.0.2.20',
      token: 'ROUTE_SESSION_TOKEN_MUST_NOT_LEAK',
      updatedAt: new Date('2026-09-02T12:00:00.000Z'),
      userAgent: 'Safari 19 / macOS',
      userId: targetId,
    },
    {
      createdAt: new Date('2026-09-02T07:00:00.000Z'),
      expiresAt: new Date('2027-09-02T00:00:00.000Z'),
      id: 'platform-operations-route-session-b',
      ipAddress: '192.0.2.19',
      token: 'ROUTE_SESSION_TOKEN_B_MUST_NOT_LEAK',
      updatedAt: new Date('2026-09-02T12:00:00.000Z'),
      userAgent: 'Chrome 140 / Windows',
      userId: targetId,
    },
    {
      createdAt: new Date('2026-09-01T06:00:00.000Z'),
      expiresAt: new Date('2027-09-01T00:00:00.000Z'),
      id: 'platform-operations-route-session-a',
      ipAddress: null,
      token: 'ROUTE_SESSION_TOKEN_A_MUST_NOT_LEAK',
      updatedAt: new Date('2026-09-02T11:00:00.000Z'),
      userAgent: null,
      userId: targetId,
    },
    {
      createdAt: new Date('2026-09-03T08:00:00.000Z'),
      expiresAt: new Date('2027-09-03T00:00:00.000Z'),
      id: 'platform-operations-route-other-session',
      ipAddress: '192.0.2.21',
      token: 'ROUTE_OTHER_SESSION_TOKEN_MUST_NOT_LEAK',
      updatedAt: new Date('2026-09-03T12:00:00.000Z'),
      userAgent: 'OTHER_USER_AGENT_MUST_NOT_LEAK',
      userId: ordinaryId,
    },
  ]);
});

afterAll(async () => {
  await db.delete(userRoles).where(eq(userRoles.userId, standardAdminId));
  await db.delete(userRoles).where(eq(userRoles.userId, adminId));
  await db.delete(users).where(eq(users.id, targetId));
  await db.delete(users).where(eq(users.id, ordinaryId));
  await db.delete(users).where(eq(users.id, standardAdminId));
  await db.delete(users).where(eq(users.id, adminId));
});

describe('platform operations tRPC authorization and projections', () => {
  it('summarizes one deduplicated user page without calling the per-user overview model', async () => {
    const accountId = '9bd6bb43-f1aa-4dde-af55-29478446109e';
    await db.insert(platformCreditAccounts).values({
      balanceCredits: 321_000,
      id: accountId,
      userId: targetId,
      userIdSnapshot: targetId,
    });
    const getOverview = vi.spyOn(PlatformUserContentModel.prototype, 'getOverview');

    try {
      await expect(
        ordinaryCaller().getUserSummaries({ userIds: [targetId] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const result = await adminCaller().getUserSummaries({
        userIds: [ordinaryId, targetId, targetId],
      });

      expect(result).toEqual({
        items: [
          {
            balanceCredits: 0,
            generationTotal: 0,
            groupReadiness: 'missing',
            userId: ordinaryId,
          },
          {
            balanceCredits: 321_000,
            generationTotal: 1,
            groupReadiness: 'ready',
            userId: targetId,
          },
        ],
      });
      expect(getOverview).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(
        /ROUTE_(?:GROUP|GENERATION|MODEL|PROVIDER|PROMPT)|provider|model|prompt|config|content|workspaceId/,
      );

      await expect(
        adminCaller().getUserSummaries({
          userIds: Array.from({ length: 51 }, (_, index) => `u-${index}`),
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        adminCaller().getUserSummaries({ userIds: [`${targetId}${String.fromCharCode(0)}`] }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    } finally {
      getOverview.mockRestore();
      await db.delete(platformCreditAccounts).where(eq(platformCreditAccounts.id, accountId));
    }
  });

  it('redacts a sensitive private-group avatar from the administrator projection', async () => {
    await db
      .update(chatGroups)
      .set({ avatar: 'contact@example.com' })
      .where(eq(chatGroups.id, targetGroupId));

    try {
      const result = await adminCaller().listUserPrivateGroups({ targetUserId: targetId });
      expect(result.items[0]?.avatar).toBeNull();
    } finally {
      await db.update(chatGroups).set({ avatar: null }).where(eq(chatGroups.id, targetGroupId));
    }
  });

  it('lists only the target user private groups through a guarded safe projection', async () => {
    const adminProcedure = adminCaller().listUserPrivateGroups;
    const ordinaryProcedure = ordinaryCaller().listUserPrivateGroups;

    await expect(ordinaryProcedure({ targetUserId: targetId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const result = await adminProcedure({ limit: 1, targetUserId: targetId });

    expect(result.items).toEqual([
      expect.objectContaining({
        clientId: 'default-travel-service-group',
        id: targetGroupId,
        title: '旅游服务超级群组',
      }),
    ]);
    expect(Object.keys(result.items[0]).sort()).toEqual([
      'avatar',
      'clientId',
      'createdAt',
      'description',
      'id',
      'title',
      'updatedAt',
    ]);
    expect(result.nextCursor).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(
      /ROUTE_GROUP_(?:CONFIG|PROMPT)_MUST_NOT_LEAK|config|content|editorData|systemPrompt|workspaceId|userId/,
    );

    await expect(adminProcedure({ limit: 0, targetUserId: targetId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(adminProcedure({ limit: 51, targetUserId: targetId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      adminProcedure({ cursor: 'bad-cursor', targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('returns a safe member projection and hides every out-of-scope group as NOT_FOUND', async () => {
    const adminProcedure = adminCaller().getUserPrivateGroupMembers;
    const ordinaryProcedure = ordinaryCaller().getUserPrivateGroupMembers;

    await expect(
      ordinaryProcedure({ groupId: targetGroupId, targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const result = await adminProcedure({ groupId: targetGroupId, targetUserId: targetId });

    expect(result).toEqual({
      items: [
        {
          agentId: 'platform-operations-route-agent',
          avatar: null,
          clientId: 'platform-operations-route-supervisor',
          description: null,
          enabled: true,
          name: null,
          order: 0,
          role: 'supervisor',
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /ROUTE_MODEL_KEY_MUST_NOT_LEAK|agencyConfig|config|systemPrompt|systemRole|provider|model|key|workspaceId|userId/,
    );

    for (const input of [
      { groupId: 'platform-operations-route-missing-group', targetUserId: targetId },
      { groupId: targetGroupId, targetUserId: ordinaryId },
      { groupId: targetPublicGroupId, targetUserId: targetId },
      { groupId: targetTeamGroupId, targetUserId: targetId },
    ]) {
      await expect(adminProcedure(input)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Private group was not found',
      });
    }

    await expect(
      adminProcedure({ groupId: targetGroupId, limit: 0, targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      adminProcedure({ groupId: targetGroupId, limit: 51, targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      adminProcedure({ cursor: 'bad-cursor', groupId: targetGroupId, targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      adminProcedure({
        groupId: `${targetGroupId}${String.fromCharCode(0)}`,
        targetUserId: targetId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects ordinary users from list and per-user overview procedures', async () => {
    await expect(ordinaryCaller().listUsers()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ordinaryCaller().listAuditEvents()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      ordinaryCaller().getUserSessionOverview({ targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      ordinaryCaller().getUserContentCatalog({ kind: 'generation', targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      ordinaryCaller().revokeUserSessions({ targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ordinaryCaller().getUserOverview({ userId: targetId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      ordinaryCaller().getUserTravelGroupHealthOverview({ targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      ordinaryCaller().repairUserTravelGroup({
        confirmed: true,
        planFingerprint: 'a'.repeat(64),
        targetUserId: targetId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      ordinaryCaller().banUser({ reason: '滥用风险', targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ordinaryCaller().unbanUser({ targetUserId: targetId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      ordinaryCaller().updateUserProfile({ fullName: '越权更名', targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      ordinaryCaller().forceUserPasswordReset({ targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.forcePasswordReset).not.toHaveBeenCalled();
  });

  it('rejects standard admins and deleted administrator identities from every user-management boundary', async () => {
    for (const caller of [standardAdminCaller(), deletedAdminCaller()]) {
      await expect(caller.listUsers()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller.listAuditEvents({ targetUserId: targetId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(caller.getUserOverview({ userId: targetId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        caller.getUserTravelGroupHealthOverview({ targetUserId: targetId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        caller.repairUserTravelGroup({
          confirmed: true,
          planFingerprint: 'a'.repeat(64),
          targetUserId: targetId,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller.getUserSessionOverview({ targetUserId: targetId })).rejects.toMatchObject(
        { code: 'FORBIDDEN' },
      );
      await expect(
        caller.getUserContentCatalog({ kind: 'generation', targetUserId: targetId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        caller.banUser({ reason: '滥用风险', targetUserId: targetId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller.unbanUser({ targetUserId: targetId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(caller.revokeUserSessions({ targetUserId: targetId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        caller.updateUserProfile({ fullName: '越权更名', targetUserId: targetId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller.forceUserPasswordReset({ targetUserId: targetId })).rejects.toMatchObject(
        { code: 'FORBIDDEN' },
      );
    }
    expect(mocks.revokeUser).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.forcePasswordReset).not.toHaveBeenCalled();
  });

  it('fails closed for a banned super_admin with an existing caller context', async () => {
    await db.update(users).set({ banned: true }).where(eq(users.id, adminId));

    await expect(adminCaller().listUsers()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(adminCaller().listAuditEvents()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      adminCaller().getUserSessionOverview({ targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      adminCaller().getUserContentCatalog({ kind: 'generation', targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      adminCaller().getUserTravelGroupHealthOverview({ targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      adminCaller().repairUserTravelGroup({
        confirmed: true,
        planFingerprint: 'a'.repeat(64),
        targetUserId: targetId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      adminCaller().revokeUserSessions({ targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(adminCaller().getUserOverview({ userId: targetId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      adminCaller().banUser({ reason: '滥用风险', targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(adminCaller().unbanUser({ targetUserId: targetId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      adminCaller().updateUserProfile({ fullName: '越权更名', targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      adminCaller().forceUserPasswordReset({ targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects control-character target identifiers at every user-management boundary', async () => {
    const caller = adminCaller();
    const maliciousTargetUserId = `victim${String.fromCharCode(0)}admin`;

    await expect(caller.getUserOverview({ userId: maliciousTargetUserId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.getUserTravelGroupHealthOverview({ targetUserId: maliciousTargetUserId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.repairUserTravelGroup({
        confirmed: true,
        planFingerprint: 'a'.repeat(64),
        targetUserId: maliciousTargetUserId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.getUserSessionOverview({ targetUserId: maliciousTargetUserId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.getUserContentCatalog({
        kind: 'generation',
        targetUserId: maliciousTargetUserId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.listAuditEvents({ targetUserId: maliciousTargetUserId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.banUser({ reason: '滥用风险', targetUserId: maliciousTargetUserId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.unbanUser({ targetUserId: maliciousTargetUserId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.revokeUserSessions({ targetUserId: maliciousTargetUserId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.updateUserProfile({ fullName: '越权更名', targetUserId: maliciousTargetUserId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.forceUserPasswordReset({ targetUserId: maliciousTargetUserId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.revokeUser).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.forcePasswordReset).not.toHaveBeenCalled();
  });

  it.each([
    ['banUser', () => adminCaller().banUser({ reason: '滥用风险', targetUserId: targetId })],
    ['unbanUser', () => adminCaller().unbanUser({ targetUserId: targetId })],
    ['revokeUserSessions', () => adminCaller().revokeUserSessions({ targetUserId: targetId })],
    [
      'updateUserProfile',
      () => adminCaller().updateUserProfile({ fullName: '管理员更名', targetUserId: targetId }),
    ],
    [
      'forceUserPasswordReset',
      () => adminCaller().forceUserPasswordReset({ targetUserId: targetId }),
    ],
  ])('revalidates active super_admin status immediately before %s side effects', async (_, run) => {
    const originalFindFirst = db.query.users.findFirst.bind(db.query.users);
    const findFirst = vi.spyOn(db.query.users, 'findFirst');
    findFirst
      .mockImplementationOnce((options: any) => originalFindFirst(options))
      .mockResolvedValueOnce({ banned: true, id: adminId } as never);

    await expect(run()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.revokeUser).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.forcePasswordReset).not.toHaveBeenCalled();
  });

  it('rejects unknown targets before any existing mutation service is invoked', async () => {
    const caller = adminCaller();
    const missingTargetUserId = 'platform-operations-route-missing-mutation-target';

    await expect(
      caller.banUser({ reason: '滥用风险', targetUserId: missingTargetUserId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller.unbanUser({ targetUserId: missingTargetUserId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      caller.revokeUserSessions({ targetUserId: missingTargetUserId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller.updateUserProfile({ fullName: '管理员更名', targetUserId: missingTargetUserId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller.forceUserPasswordReset({ targetUserId: missingTargetUserId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller.repairUserTravelGroup({
        confirmed: true,
        planFingerprint: 'a'.repeat(64),
        targetUserId: missingTargetUserId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.revokeUser).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.forcePasswordReset).not.toHaveBeenCalled();
  });

  it('returns a stable paginated safe session overview isolated to the requested user', async () => {
    const firstPage = await adminCaller().getUserSessionOverview({
      limit: 2,
      targetUserId: targetId,
    });

    expect(firstPage).toEqual({
      items: [
        {
          createdAt: new Date('2026-09-02T08:00:00.000Z'),
          expiresAt: new Date('2027-09-02T00:00:00.000Z'),
          ipAddress: '192.0.2.20',
          updatedAt: new Date('2026-09-02T12:00:00.000Z'),
          userAgent: 'Safari 19 / macOS',
        },
        {
          createdAt: new Date('2026-09-02T07:00:00.000Z'),
          expiresAt: new Date('2027-09-02T00:00:00.000Z'),
          ipAddress: '192.0.2.19',
          updatedAt: new Date('2026-09-02T12:00:00.000Z'),
          userAgent: 'Chrome 140 / Windows',
        },
      ],
      nextCursor: expect.any(String),
      total: 3,
    });
    for (const item of firstPage.items) {
      expect(Object.keys(item).sort()).toEqual([
        'createdAt',
        'expiresAt',
        'ipAddress',
        'updatedAt',
        'userAgent',
      ]);
    }

    const secondPage = await adminCaller().getUserSessionOverview({
      cursor: firstPage.nextCursor!,
      limit: 2,
      targetUserId: targetId,
    });
    expect(secondPage).toEqual({
      items: [
        {
          createdAt: new Date('2026-09-01T06:00:00.000Z'),
          expiresAt: new Date('2027-09-01T00:00:00.000Z'),
          ipAddress: null,
          updatedAt: new Date('2026-09-02T11:00:00.000Z'),
          userAgent: null,
        },
      ],
      nextCursor: null,
      total: 3,
    });
    expect(JSON.stringify([firstPage, secondPage])).not.toMatch(
      /ROUTE_.*TOKEN|OTHER_USER_AGENT|password|cookie|provider.*key|emailBody/i,
    );
  });

  it('redacts credentials embedded in attacker-controlled session user agents', async () => {
    const credential = 'sk-live-session-abcdefghijklmnopqrstuvwxyz123456';
    try {
      await db
        .update(authSessions)
        .set({ userAgent: `browser ${credential}` })
        .where(eq(authSessions.id, 'platform-operations-route-session-c'));

      const result = await adminCaller().getUserSessionOverview({
        limit: 1,
        targetUserId: targetId,
      });
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain(credential);
      expect(serialized).toContain('[CREDENTIAL]');
    } finally {
      await db
        .update(authSessions)
        .set({ userAgent: 'Safari 19 / macOS' })
        .where(eq(authSessions.id, 'platform-operations-route-session-c'));
    }
  });

  it('rejects invalid session overview targets, limits, and cursors without leaking internals', async () => {
    const caller = adminCaller();

    await expect(
      caller.getUserSessionOverview({ limit: 0, targetUserId: targetId }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.getUserSessionOverview({ limit: 51, targetUserId: targetId }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.getUserSessionOverview({ cursor: 'not-a-cursor', targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.getUserSessionOverview({ targetUserId: 'platform-operations-route-missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Target user was not found' });

    const findById = vi
      .spyOn(UserModel, 'findById')
      .mockRejectedValueOnce(new Error('SESSION_STORAGE_TOKEN_MUST_NOT_LEAK'));
    const error = await caller
      .getUserSessionOverview({ targetUserId: targetId })
      .catch((cause) => cause);
    expect(error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to load platform user information. Please try again.',
    });
    expect(String(error)).not.toContain('SESSION_STORAGE_TOKEN_MUST_NOT_LEAK');
    findById.mockRestore();
  });

  it('reuses canonical session revocation for a target but rejects self or unknown targets', async () => {
    const operationId = 'platform-operations-route-revoke-sessions';

    await expect(
      adminCaller().revokeUserSessions({ operationId, targetUserId: targetId }),
    ).resolves.toEqual({ id: targetId, sessionsRevoked: true });
    expect(mocks.revokeUser).toHaveBeenCalledWith(targetId, {
      operationId,
      operatorUserId: adminId,
    });

    mocks.revokeUser.mockClear();
    await expect(adminCaller().revokeUserSessions({ targetUserId: adminId })).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );
    await expect(
      adminCaller().revokeUserSessions({ targetUserId: 'platform-operations-route-missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.revokeUser).not.toHaveBeenCalled();
  });

  it('redacts unexpected session-revocation failures behind a fixed retry error', async () => {
    mocks.revokeUser.mockRejectedValueOnce(
      new Error('SESSION_PROVIDER_TOKEN_AND_COOKIE_MUST_NOT_LEAK'),
    );

    const error = await adminCaller()
      .revokeUserSessions({ targetUserId: targetId })
      .catch((cause) => cause);

    expect(error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to revoke user sessions. Please try again.',
    });
    expect(String(error)).not.toContain('SESSION_PROVIDER_TOKEN_AND_COOKIE_MUST_NOT_LEAK');
  });

  it('returns only safe administrator audit fields with cursor pagination and filters', async () => {
    const firstPage = await adminCaller().listAuditEvents({
      action: 'user.profile_updated',
      endAt: new Date('2026-09-02T12:30:00.000Z'),
      limit: 2,
      startAt: new Date('2026-09-02T09:30:00.000Z'),
      targetUserId: auditTargetId,
    });

    expect(firstPage.items.map(({ phase }) => phase)).toEqual(['failed', 'succeeded']);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    for (const item of firstPage.items) {
      expect(Object.keys(item).sort()).toEqual([
        'action',
        'occurredAt',
        'operatorUserId',
        'phase',
        'targetUserId',
      ]);
    }

    const secondPage = await adminCaller().listAuditEvents({
      action: 'user.profile_updated',
      cursor: firstPage.nextCursor!,
      endAt: new Date('2026-09-02T12:30:00.000Z'),
      limit: 2,
      startAt: new Date('2026-09-02T09:30:00.000Z'),
      targetUserId: auditTargetId,
    });
    expect(secondPage.items.map(({ phase }) => phase)).toEqual(['requested']);
    expect(secondPage.nextCursor).toBeNull();
    const serialized = JSON.stringify([firstPage, secondPage]);
    expect(serialized).not.toMatch(/password|token|emailBody|ipAddress|metadata|operationId/i);
    expect(serialized).not.toContain('platform-operations-route-audit-profile-failed');
    expect(serialized).not.toContain('platform-operations-route-audit-profile-succeeded');
    expect(serialized).not.toContain('platform-operations-route-audit-profile-requested');
  });

  it('rejects invalid administrator audit pagination, cursor, filters, and time ranges', async () => {
    const caller = adminCaller();

    await expect(caller.listAuditEvents({ limit: 0 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller.listAuditEvents({ limit: 101 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller.listAuditEvents({ cursor: 'bm90LWpzb24' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.listAuditEvents({ action: 'user.email_body_read' } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.listAuditEvents({
        endAt: new Date('2026-09-01T00:00:00.000Z'),
        startAt: new Date('2026-09-02T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('updates a target profile through the account service and returns only safe fields', async () => {
    const operationId = 'platform-operations-route-profile-success';
    const result = await adminCaller().updateUserProfile({
      avatar: 'https://example.com/customer-updated.png',
      fullName: '  西藏旅行客户·更新  ',
      operationId,
      targetUserId: targetId,
    });

    expect(mocks.updateProfile).toHaveBeenCalledWith({
      avatar: 'https://example.com/customer-updated.png',
      fullName: '西藏旅行客户·更新',
      operationId,
      operatorUserId: adminId,
      targetUserId: targetId,
    });
    expect(result).toEqual({
      avatar: 'https://example.com/customer-updated.png',
      fullName: '西藏旅行客户·更新',
      id: targetId,
    });
    expect(Object.keys(result).sort()).toEqual(['avatar', 'fullName', 'id']);
    expect(JSON.stringify(result)).not.toMatch(/email|password|token|provider/i);
  });

  it('allows null avatar clearing but rejects unsafe URLs, control characters, and extra password fields', async () => {
    const caller = adminCaller();

    await expect(
      caller.updateUserProfile({ avatar: null, targetUserId: targetId }),
    ).resolves.toEqual({
      avatar: 'https://example.com/customer-updated.png',
      fullName: '西藏旅行客户·更新',
      id: targetId,
    });
    expect(mocks.updateProfile).toHaveBeenLastCalledWith({
      avatar: null,
      fullName: undefined,
      operationId: expect.any(String),
      operatorUserId: adminId,
      targetUserId: targetId,
    });

    for (const avatar of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      `https://example.com/${'a'.repeat(2048)}`,
    ]) {
      await expect(
        caller.updateUserProfile({ avatar, targetUserId: targetId }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    for (const fullName of [
      'Line\nBreak',
      `Hidden${String.fromCharCode(0)}Name`,
      'a'.repeat(101),
    ]) {
      await expect(
        caller.updateUserProfile({ fullName, targetUserId: targetId }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    await expect(
      caller.updateUserProfile({
        fullName: '攻击者',
        password: 'ADMIN_MUST_NOT_SET_THIS',
        targetUserId: targetId,
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('requests a one-time reset without accepting or returning password material', async () => {
    const operationId = 'platform-operations-route-reset-success';
    const result = await adminCaller().forceUserPasswordReset({
      operationId,
      targetUserId: targetId,
    });

    expect(mocks.forcePasswordReset).toHaveBeenCalledWith({
      operationId,
      operatorUserId: adminId,
      targetUserId: targetId,
    });
    expect(result).toEqual({ id: targetId, resetRequested: true });
    expect(Object.keys(result).sort()).toEqual(['id', 'resetRequested']);
    expect(JSON.stringify(result)).not.toMatch(/email|password|hash|token|provider/i);
    await expect(
      adminCaller().forceUserPasswordReset({
        newPassword: 'ADMIN_MUST_NOT_SET_THIS',
        targetUserId: targetId,
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('blocks self profile/password-reset operations before invoking the service', async () => {
    const caller = adminCaller();

    await expect(
      caller.updateUserProfile({ fullName: '管理员新姓名', targetUserId: adminId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.forceUserPasswordReset({ targetUserId: adminId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.forcePasswordReset).not.toHaveBeenCalled();
  });

  it('projects account-administration failures to a fixed retry error without internals', async () => {
    mocks.forcePasswordReset.mockRejectedValueOnce(
      new PlatformUserAccountAdministrationError(
        'OPERATION_FAILED',
        PLATFORM_USER_ACCOUNT_ADMIN_RETRY_MESSAGE,
      ),
    );

    const promise = adminCaller().forceUserPasswordReset({ targetUserId: targetId });
    await expect(promise).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: PLATFORM_USER_ACCOUNT_ADMIN_RETRY_MESSAGE,
    });
    expect(JSON.stringify(await promise.catch((error) => error))).not.toMatch(
      /password|hash|token|provider|smtp/i,
    );
  });

  it('projects user-list storage failures to a fixed error without internal details', async () => {
    const listUsers = vi
      .spyOn(PlatformUserOperationsModel.prototype, 'listUsers')
      .mockRejectedValueOnce(new Error('internal-list-storage-detail'));

    const error = await adminCaller()
      .listUsers()
      .catch((cause) => cause);

    expect(error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to load platform user information. Please try again.',
    });
    expect(String(error)).not.toContain('internal-list-storage-detail');
    listUsers.mockRestore();
  });

  it('projects user-overview storage failures to a fixed error without internal details', async () => {
    const getOverview = vi
      .spyOn(PlatformUserContentModel.prototype, 'getOverview')
      .mockRejectedValueOnce(new Error('internal-overview-storage-detail'));

    const error = await adminCaller()
      .getUserOverview({ userId: targetId })
      .catch((cause) => cause);

    expect(error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to load platform user information. Please try again.',
    });
    expect(String(error)).not.toContain('internal-overview-storage-detail');
    getOverview.mockRestore();
  });

  it('lets a super_admin ban a target and returns only the safe account state', async () => {
    const banExpires = new Date(Date.now() + 86_400_000);
    const operationId = 'platform-operations-route-ban-success';

    const result = await adminCaller().banUser({
      banExpires,
      operationId,
      reason: '反复滥用生成服务',
      targetUserId: targetId,
    });

    expect(result).toEqual({
      banExpires,
      banned: true,
      banReason: '反复滥用生成服务',
      id: targetId,
    });
    expect(Object.keys(result).sort()).toEqual(['banExpires', 'banReason', 'banned', 'id']);
    expect(JSON.stringify(result)).not.toMatch(/token|password|session/i);
    await expect(
      db.select().from(authSessions).where(eq(authSessions.userId, targetId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(authSessions).where(eq(authSessions.userId, ordinaryId)),
    ).resolves.toHaveLength(1);
    expect(mocks.revokeUser).toHaveBeenCalledWith(targetId, {
      operationId,
      operatorUserId: adminId,
    });
    const auditEvents = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(auditEvents.map(({ action, phase }) => ({ action, phase }))).toEqual([
      { action: 'user.banned', phase: 'requested' },
      { action: 'user.banned', phase: 'succeeded' },
    ]);
    expect(JSON.stringify(auditEvents)).not.toMatch(
      /反复滥用生成服务|ROUTE_SESSION_TOKEN|192\.0\.2\./i,
    );
  });

  it('keeps the account banned and returns a safe retryable error when credential revocation fails', async () => {
    mocks.revokeUser.mockRejectedValueOnce(
      new PlatformAuthRevocationError(['better-auth-session']),
    );

    const promise = adminCaller().banUser({
      operationId: 'platform-operations-route-ban-revoke-failed',
      reason: '反复滥用生成服务',
      targetUserId: targetId,
    });

    await expect(promise).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: PLATFORM_AUTH_REVOCATION_RETRY_MESSAGE,
    });
    const [target] = await db.select().from(users).where(eq(users.id, targetId));
    expect(target).toMatchObject({ banned: true, banReason: '反复滥用生成服务' });
    expect(JSON.stringify(await promise.catch((error) => error))).not.toMatch(
      /token|password|provider|prompt/i,
    );
  });

  it('rejects self-banning and keeps the administrator account active', async () => {
    await expect(
      adminCaller().banUser({ reason: '误操作', targetUserId: adminId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const [admin] = await db.select().from(users).where(eq(users.id, adminId));
    expect(admin.banned).not.toBe(true);
  });

  it('fails closed before a blocked administrator can self-unban', async () => {
    const banExpires = new Date(Date.now() + 86_400_000);
    await db
      .update(users)
      .set({ banExpires, banned: true, banReason: '另一位管理员封禁' })
      .where(eq(users.id, adminId));

    await expect(adminCaller().unbanUser({ targetUserId: adminId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const [admin] = await db.select().from(users).where(eq(users.id, adminId));
    expect(admin).toMatchObject({
      banExpires,
      banned: true,
      banReason: '另一位管理员封禁',
    });
  });

  it('unbans safely without restoring revoked sessions', async () => {
    const caller = adminCaller();
    await caller.banUser({ reason: '临时封禁', targetUserId: targetId });
    mocks.revokeUser.mockClear();
    const operationId = 'platform-operations-route-unban-success';

    await expect(caller.unbanUser({ operationId, targetUserId: targetId })).resolves.toEqual({
      banExpires: null,
      banned: false,
      banReason: null,
      id: targetId,
    });
    await expect(
      db.select().from(authSessions).where(eq(authSessions.userId, targetId)),
    ).resolves.toHaveLength(0);
    expect(mocks.revokeUser).toHaveBeenCalledWith(targetId, {
      operationId,
      operatorUserId: adminId,
    });
  });

  it('keeps a user banned when the unban credential-revocation preflight fails', async () => {
    await db
      .update(users)
      .set({ banned: true, banReason: '凭证复核' })
      .where(eq(users.id, targetId));
    mocks.revokeUser.mockRejectedValueOnce(new PlatformAuthRevocationError(['oidc-artifact']));

    const operationId = 'platform-operations-route-unban-revoke-failed';
    await expect(
      adminCaller().unbanUser({ operationId, targetUserId: targetId }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: PLATFORM_AUTH_REVOCATION_RETRY_MESSAGE,
    });

    const [target] = await db.select().from(users).where(eq(users.id, targetId));
    expect(target).toMatchObject({ banned: true, banReason: '凭证复核' });
    const auditEvents = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(auditEvents.map(({ action, phase }) => ({ action, phase }))).toEqual([
      { action: 'user.unbanned', phase: 'requested' },
      { action: 'user.unbanned', phase: 'failed' },
    ]);
  });

  it('strictly validates ban inputs and exposes no password mutation procedure', async () => {
    const caller = adminCaller();

    await expect(caller.banUser({ reason: ' ', targetUserId: targetId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.banUser({
        banExpires: new Date(Date.now() - 1000),
        reason: '风险',
        targetUserId: targetId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.banUser({
        password: 'must-not-be-accepted',
        reason: '风险',
        targetUserId: targetId,
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((platformOperationsRouter as any)._def.procedures).not.toHaveProperty('setPassword');
    expect((platformOperationsRouter as any)._def.procedures).not.toHaveProperty('updatePassword');
    expect((platformOperationsRouter as any)._def.procedures).not.toHaveProperty('grantRole');
    expect((platformOperationsRouter as any)._def.procedures).not.toHaveProperty('setRole');
    expect((platformOperationsRouter as any)._def.procedures).not.toHaveProperty('updateRole');
  });

  it('rejects every sensitive-data category in a ban reason without echoing or persisting it', async () => {
    const reasons = [
      'password=SecretValue123!',
      '联系邮箱 private@example.com',
      '手机 13812345678',
      '身份证 11010519491231002X',
    ];

    for (const reason of reasons) {
      const promise = adminCaller().banUser({ reason, targetUserId: targetId });

      await expect(promise).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Ban reason must not contain sensitive information',
      });
      expect(JSON.stringify(await promise.catch((error) => error))).not.toContain(reason);
    }

    const [target] = await db.select().from(users).where(eq(users.id, targetId));
    expect(target).toMatchObject({ banExpires: null, banned: false, banReason: null });
    await expect(
      db.select().from(authSessions).where(eq(authSessions.userId, targetId)),
    ).resolves.toHaveLength(3);
    expect(mocks.revokeUser).not.toHaveBeenCalled();
  });

  it('returns a super_admin user list with the CNY service ledger kept separate from credits', async () => {
    const result = await adminCaller().listUsers({
      limit: 10,
      query: 'platform-operations-customer',
    });

    expect(result).toMatchObject({ limit: 10, offset: 0, total: 1 });
    expect(result.items).toEqual([
      expect.objectContaining({
        email: 'platform-operations-customer@example.com',
        fullName: '西藏旅行客户',
        id: targetId,
        latestSessionIp: '192.0.2.20',
        travelServiceLedger: {
          balanceFen: 1234,
          currency: 'CNY',
          totalConsumptionFen: 0,
        },
      }),
    ]);
    expect(result.items[0]).not.toHaveProperty('balanceFen');
    expect(result.items[0]).not.toHaveProperty('totalConsumptionFen');
    expect(result.items[0]).not.toHaveProperty('credits');
  });

  it('redacts credentials embedded in legacy UI-visible profile and content metadata', async () => {
    const credential = 'sk-live-abcdefghijklmnopqrstuvwxyz123456';
    try {
      await db
        .update(users)
        .set({
          banned: true,
          banReason: `legacy ${credential}`,
          fullName: `customer ${credential}`,
        })
        .where(eq(users.id, targetId));
      await db
        .update(chatGroups)
        .set({ title: `group ${credential}` })
        .where(eq(chatGroups.id, targetGroupId));
      await db
        .update(works)
        .set({ title: `work ${credential}` })
        .where(eq(works.id, 'platform-operations-route-work'));
      await db
        .update(documents)
        .set({ filename: `file-${credential}.md`, title: `document ${credential}` })
        .where(eq(documents.id, 'platform-operations-route-document'));

      const [userList, overview, documentCatalog] = await Promise.all([
        adminCaller().listUsers({ query: 'platform-operations-customer' }),
        adminCaller().getUserOverview({ userId: targetId }),
        adminCaller().getUserContentCatalog({ kind: 'document', targetUserId: targetId }),
      ]);
      const serialized = JSON.stringify([userList, overview, documentCatalog]);

      expect(serialized).not.toContain(credential);
      expect(serialized).toContain('[CREDENTIAL]');
    } finally {
      await db
        .update(users)
        .set({ banned: false, banReason: null, fullName: '西藏旅行客户' })
        .where(eq(users.id, targetId));
      await db
        .update(chatGroups)
        .set({ title: '旅游服务超级群组' })
        .where(eq(chatGroups.id, targetGroupId));
      await db
        .update(works)
        .set({ title: '西藏旅游文案' })
        .where(eq(works.id, 'platform-operations-route-work'));
      await db
        .update(documents)
        .set({ filename: null, title: '旅游文案文稿' })
        .where(eq(documents.id, 'platform-operations-route-document'));
    }
  });

  it('enforces user-list pagination boundaries', async () => {
    const caller = adminCaller();

    await expect(
      caller.listUsers({ limit: 1, offset: 0, query: 'platform-operations-customer' }),
    ).resolves.toMatchObject({ limit: 1, offset: 0, total: 1 });
    await expect(caller.listUsers({ limit: 100, offset: 0 })).resolves.toMatchObject({
      limit: 100,
      offset: 0,
    });
    await expect(caller.listUsers({ limit: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.listUsers({ limit: 101 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.listUsers({ offset: -1 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('keeps user, IP, and service-ledger results on a strict field allowlist', async () => {
    const result = await adminCaller().listUsers({
      limit: 1,
      query: 'platform-operations-customer',
    });
    const item = result.items[0];
    if (!item) throw new Error('Expected one platform user result');

    expect(Object.keys(item).sort()).toEqual([
      'avatar',
      'banExpires',
      'banReason',
      'banned',
      'createdAt',
      'email',
      'emailVerified',
      'fullName',
      'id',
      'lastActiveAt',
      'latestSessionAt',
      'latestSessionIp',
      'travelServiceLedger',
      'username',
    ]);
    expect(Object.keys(item.travelServiceLedger).sort()).toEqual([
      'balanceFen',
      'currency',
      'totalConsumptionFen',
    ]);
  });

  it('returns NOT_FOUND when an administrator requests an unknown user overview', async () => {
    await expect(
      adminCaller().getUserOverview({ userId: 'platform-operations-route-missing' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Target user was not found',
    });
    await expect(
      adminCaller().getUserTravelGroupHealthOverview({
        targetUserId: 'platform-operations-route-missing',
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Target user was not found',
    });
  });

  it('returns a safe healthy private-group preview for exactly the requested user', async () => {
    vi.spyOn(travelServiceGroup, 'getDefaultTravelServiceGroupHealthSummary').mockImplementation(
      async (_database, { targetUserId }) =>
        ({
          groupCount: 1,
          healthy: targetUserId === ordinaryId,
          isPrivate: true,
          issueCodes: targetUserId === ordinaryId ? [] : ['COPYWRITER_MISSING'],
          requiredMembers: {
            'copywriter': { enabled: false, exists: false, platformManaged: false },
            'designer': { enabled: true, exists: true, platformManaged: true },
            'document-assistant': { enabled: true, exists: true, platformManaged: true },
            'video-producer': { enabled: true, exists: true, platformManaged: true },
          },
          secretProviderKey: 'GROUP_HEALTH_PROVIDER_KEY_MUST_NOT_LEAK',
          supervisor: { count: 1, platformManaged: true, titleMatches: true },
          systemRole: 'GROUP_HEALTH_SYSTEM_ROLE_MUST_NOT_LEAK',
        }) as never,
    );

    const result = await adminCaller().getUserTravelGroupHealthOverview({
      targetUserId: ordinaryId,
    });

    expect(result).toEqual({
      actionCounts: [],
      canRepair: false,
      issueCodes: [],
      planFingerprint: expect.stringMatching(/^[a-f\d]{64}$/),
      ready: true,
      reviewRequired: false,
    });
    expect(JSON.stringify(result)).not.toContain('GROUP_HEALTH_PROVIDER_KEY_MUST_NOT_LEAK');
    expect(JSON.stringify(result)).not.toContain('GROUP_HEALTH_SYSTEM_ROLE_MUST_NOT_LEAK');
  });

  it('marks duplicate groups and multiple supervisors as review-required fixed actions', async () => {
    vi.spyOn(travelServiceGroup, 'getDefaultTravelServiceGroupHealthSummary').mockResolvedValue({
      groupCount: 2,
      healthy: false,
      isPrivate: true,
      issueCodes: ['DEFAULT_GROUP_DUPLICATED', 'SUPERVISOR_COUNT_INVALID'],
      requiredMembers: {
        'copywriter': { enabled: true, exists: true, platformManaged: true },
        'designer': { enabled: true, exists: true, platformManaged: true },
        'document-assistant': { enabled: true, exists: true, platformManaged: true },
        'video-producer': { enabled: true, exists: true, platformManaged: true },
      },
      supervisor: { count: 2, platformManaged: false, titleMatches: false },
    });

    await expect(
      adminCaller().getUserTravelGroupHealthOverview({ targetUserId: targetId }),
    ).resolves.toEqual({
      actionCounts: [
        { code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED', count: 1 },
        { code: 'SUPERVISOR_REVIEW_REQUIRED', count: 1 },
      ],
      canRepair: false,
      issueCodes: ['DEFAULT_GROUP_DUPLICATED', 'SUPERVISOR_COUNT_INVALID'],
      planFingerprint: expect.stringMatching(/^[a-f\d]{64}$/),
      ready: false,
      reviewRequired: true,
    });
  });

  it('fails closed on an unknown health code without returning the unknown value', async () => {
    const unknownIssueCode = 'FUTURE_SECRET_PROVIDER_KEY_ISSUE';
    vi.spyOn(travelServiceGroup, 'getDefaultTravelServiceGroupHealthSummary').mockResolvedValue({
      groupCount: 1,
      healthy: false,
      isPrivate: true,
      issueCodes: [unknownIssueCode],
      requiredMembers: {
        'copywriter': { enabled: true, exists: true, platformManaged: true },
        'designer': { enabled: true, exists: true, platformManaged: true },
        'document-assistant': { enabled: true, exists: true, platformManaged: true },
        'video-producer': { enabled: true, exists: true, platformManaged: true },
      },
      supervisor: { count: 1, platformManaged: true, titleMatches: true },
    } as never);

    const result = await adminCaller().getUserTravelGroupHealthOverview({
      targetUserId: targetId,
    });
    expect(result).toEqual({
      actionCounts: [{ code: 'UNKNOWN_ISSUE_REVIEW_REQUIRED', count: 1 }],
      canRepair: false,
      issueCodes: [],
      planFingerprint: expect.stringMatching(/^[a-f\d]{64}$/),
      ready: false,
      reviewRequired: true,
    });
    expect(JSON.stringify(result)).not.toContain(unknownIssueCode);
  });

  it('returns a target-bound safe repair fingerprint and executes only after explicit confirmation', async () => {
    const health = vi
      .spyOn(travelServiceGroup, 'getDefaultTravelServiceGroupHealthSummary')
      .mockResolvedValueOnce(safeTravelGroupRepairHealth as never);
    const execute = vi
      .spyOn(travelServiceGroup, 'executeDefaultTravelServiceGroupRepairPlan')
      .mockResolvedValue({
        actionCounts: [{ code: 'SET_PRIVATE', count: 1 }],
        finalHealth: healthyTravelGroupHealth,
      } as never);

    const preview = await adminCaller().getUserTravelGroupHealthOverview({
      targetUserId: targetId,
    });
    expect(preview).toEqual({
      actionCounts: [{ code: 'SET_PRIVATE', count: 1 }],
      canRepair: true,
      issueCodes: ['DEFAULT_GROUP_NOT_PRIVATE'],
      planFingerprint: expect.stringMatching(/^[a-f\d]{64}$/),
      ready: false,
      reviewRequired: false,
    });

    await expect(
      adminCaller().repairUserTravelGroup({
        planFingerprint: preview.planFingerprint,
        targetUserId: targetId,
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      adminCaller().repairUserTravelGroup({
        actions: [{ code: 'DELETE_GROUP' }],
        confirmed: true,
        planFingerprint: preview.planFingerprint,
        targetUserId: targetId,
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(execute).not.toHaveBeenCalled();

    health
      .mockResolvedValueOnce(safeTravelGroupRepairHealth as never)
      .mockResolvedValueOnce(healthyTravelGroupHealth as never);
    const operationId = 'platform-operations-route-travel-group-repair';
    const result = await adminCaller().repairUserTravelGroup({
      confirmed: true,
      operationId,
      planFingerprint: preview.planFingerprint,
      targetUserId: targetId,
    });

    expect(result).toEqual({
      actionCounts: [{ code: 'SET_PRIVATE', count: 1 }],
      ready: true,
      reviewRequired: false,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(db, {
      expectedPlan: {
        actions: [{ code: 'SET_PRIVATE', reviewRequired: false, target: 'group' }],
        reviewRequired: false,
      },
      targetUserId: targetId,
    });
    const auditEvents = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(auditEvents.map(({ action, phase }) => ({ action, phase }))).toEqual([
      { action: 'user.travel_group_repaired', phase: 'requested' },
      { action: 'user.travel_group_repaired', phase: 'succeeded' },
    ]);
    expect(JSON.stringify(auditEvents)).not.toMatch(/prompt|model|provider|member|fingerprint/i);
  });

  it('rejects stale or target-swapped repair fingerprints before executing', async () => {
    vi.spyOn(travelServiceGroup, 'getDefaultTravelServiceGroupHealthSummary')
      .mockResolvedValueOnce(safeTravelGroupRepairHealth as never)
      .mockResolvedValueOnce(safeTravelGroupRepairHealth as never)
      .mockResolvedValueOnce(safeTravelGroupRepairHealth as never)
      .mockResolvedValueOnce({
        ...safeTravelGroupRepairHealth,
        isPrivate: true,
        issueCodes: ['COPYWRITER_MISSING'],
        requiredMembers: {
          ...safeTravelGroupRepairHealth.requiredMembers,
          copywriter: { enabled: false, exists: false, platformManaged: false },
        },
      } as never);
    const execute = vi.spyOn(travelServiceGroup, 'executeDefaultTravelServiceGroupRepairPlan');
    const targetPreview = await adminCaller().getUserTravelGroupHealthOverview({
      targetUserId: targetId,
    });
    const otherPreview = await adminCaller().getUserTravelGroupHealthOverview({
      targetUserId: ordinaryId,
    });
    expect(targetPreview.planFingerprint).not.toBe(otherPreview.planFingerprint);

    await expect(
      adminCaller().repairUserTravelGroup({
        confirmed: true,
        planFingerprint: otherPreview.planFingerprint,
        targetUserId: targetId,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(
      adminCaller().repairUserTravelGroup({
        confirmed: true,
        planFingerprint: targetPreview.planFingerprint,
        targetUserId: targetId,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['DEFAULT_GROUP_DUPLICATED', { groupCount: 2 }],
    ['SUPERVISOR_COUNT_INVALID', { supervisorCount: 2 }],
    ['COPYWRITER_DUPLICATED', {}],
    ['DEFAULT_GROUP_SCOPE_INVALID', {}],
    ['FUTURE_UNKNOWN_HEALTH_STATE', {}],
  ])('never executes a review-required or unknown %s repair plan', async (issueCode, state) => {
    const healthState = {
      ...healthyTravelGroupHealth,
      groupCount: state.groupCount ?? 1,
      healthy: false,
      issueCodes: [issueCode],
      requiredMembers: { ...healthyTravelGroupHealth.requiredMembers },
      supervisor: {
        ...healthyTravelGroupHealth.supervisor,
        count: state.supervisorCount ?? 1,
      },
    };
    vi.spyOn(travelServiceGroup, 'getDefaultTravelServiceGroupHealthSummary').mockResolvedValue(
      healthState as never,
    );
    const execute = vi.spyOn(travelServiceGroup, 'executeDefaultTravelServiceGroupRepairPlan');
    const preview = await adminCaller().getUserTravelGroupHealthOverview({
      targetUserId: targetId,
    });

    expect(preview).toMatchObject({ canRepair: false, reviewRequired: true });
    await expect(
      adminCaller().repairUserTravelGroup({
        confirmed: true,
        planFingerprint: preview.planFingerprint,
        targetUserId: targetId,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('revalidates both operator and active target immediately before repair execution', async () => {
    vi.spyOn(travelServiceGroup, 'getDefaultTravelServiceGroupHealthSummary').mockResolvedValue(
      safeTravelGroupRepairHealth as never,
    );
    const execute = vi.spyOn(travelServiceGroup, 'executeDefaultTravelServiceGroupRepairPlan');
    const preview = await adminCaller().getUserTravelGroupHealthOverview({
      targetUserId: targetId,
    });

    const originalFindFirst = db.query.users.findFirst.bind(db.query.users);
    const findFirst = vi.spyOn(db.query.users, 'findFirst');
    findFirst
      .mockImplementationOnce((options: any) => originalFindFirst(options))
      .mockImplementationOnce((options: any) => originalFindFirst(options))
      .mockImplementationOnce((options: any) => originalFindFirst(options))
      .mockResolvedValueOnce({ banned: true, id: adminId } as never);
    await expect(
      adminCaller().repairUserTravelGroup({
        confirmed: true,
        planFingerprint: preview.planFingerprint,
        targetUserId: targetId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(execute).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    vi.spyOn(travelServiceGroup, 'getDefaultTravelServiceGroupHealthSummary').mockResolvedValue(
      safeTravelGroupRepairHealth as never,
    );
    const executeAfterTargetBan = vi.spyOn(
      travelServiceGroup,
      'executeDefaultTravelServiceGroupRepairPlan',
    );
    vi.spyOn(UserModel, 'findById')
      .mockResolvedValueOnce({ banned: false, id: targetId } as never)
      .mockResolvedValueOnce({ banned: true, id: targetId } as never);
    await expect(
      adminCaller().repairUserTravelGroup({
        confirmed: true,
        planFingerprint: preview.planFingerprint,
        targetUserId: targetId,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(executeAfterTargetBan).not.toHaveBeenCalled();
  });

  it('rejects an already banned repair target before reading or executing its plan', async () => {
    await db.update(users).set({ banned: true }).where(eq(users.id, targetId));
    const health = vi.spyOn(travelServiceGroup, 'getDefaultTravelServiceGroupHealthSummary');
    const execute = vi.spyOn(travelServiceGroup, 'executeDefaultTravelServiceGroupRepairPlan');

    await expect(
      adminCaller().repairUserTravelGroup({
        confirmed: true,
        planFingerprint: 'a'.repeat(64),
        targetUserId: targetId,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(health).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('coalesces concurrent repairs and makes a completed-plan retry fail stale without re-execution', async () => {
    const health = vi
      .spyOn(travelServiceGroup, 'getDefaultTravelServiceGroupHealthSummary')
      .mockResolvedValue(safeTravelGroupRepairHealth as never);
    const preview = await adminCaller().getUserTravelGroupHealthOverview({
      targetUserId: targetId,
    });
    const pending = createDeferred<any>();
    const execute = vi
      .spyOn(travelServiceGroup, 'executeDefaultTravelServiceGroupRepairPlan')
      .mockReturnValue(pending.promise);
    const input = {
      confirmed: true as const,
      planFingerprint: preview.planFingerprint,
      targetUserId: targetId,
    };
    const first = adminCaller().repairUserTravelGroup(input);
    const second = adminCaller().repairUserTravelGroup(input);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    health.mockResolvedValue(healthyTravelGroupHealth as never);
    pending.resolve({
      actionCounts: [{ code: 'SET_PRIVATE', count: 1 }],
      finalHealth: healthyTravelGroupHealth,
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { actionCounts: [{ code: 'SET_PRIVATE', count: 1 }], ready: true, reviewRequired: false },
      { actionCounts: [{ code: 'SET_PRIVATE', count: 1 }], ready: true, reviewRequired: false },
    ]);
    await expect(adminCaller().repairUserTravelGroup(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns a fixed failure and records failed audit without leaking executor details', async () => {
    vi.spyOn(travelServiceGroup, 'getDefaultTravelServiceGroupHealthSummary').mockResolvedValue(
      safeTravelGroupRepairHealth as never,
    );
    const preview = await adminCaller().getUserTravelGroupHealthOverview({
      targetUserId: targetId,
    });
    const secret = 'GROUP_EXECUTOR_PROMPT_MODEL_KEY_MEMBER_IDS_MUST_NOT_LEAK';
    vi.spyOn(travelServiceGroup, 'executeDefaultTravelServiceGroupRepairPlan').mockRejectedValue(
      new Error(secret),
    );
    const operationId = 'platform-operations-route-travel-group-repair-failed';
    const error = await adminCaller()
      .repairUserTravelGroup({
        confirmed: true,
        operationId,
        planFingerprint: preview.planFingerprint,
        targetUserId: targetId,
      })
      .catch((cause) => cause);

    expect(error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to repair the private travel group. Please try again.',
    });
    expect(String(error)).not.toContain(secret);
    const auditEvents = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(auditEvents.map(({ phase }) => phase)).toEqual(['requested', 'failed']);
    expect(JSON.stringify(auditEvents)).not.toContain(secret);
  });

  it('returns only allow-listed group, generation, work, and document metadata', async () => {
    const result = await adminCaller().getUserOverview({ recentLimit: 5, userId: targetId });

    expect(result).toMatchObject({
      generation: { statusCounts: [{ count: 1, status: 'succeeded' }], total: 1 },
      recentDocuments: [
        {
          createdAt: expect.any(Date),
          fileType: 'text/markdown',
          id: 'platform-operations-route-document',
          parentId: null,
          title: '旅游文案文稿',
          totalCharCount: 100,
          totalLineCount: 8,
          updatedAt: expect.any(Date),
        },
      ],
      recentWorks: [
        {
          createdAt: expect.any(Date),
          id: 'platform-operations-route-work',
          resourceType: 'document',
          status: 'completed',
          title: '西藏旅游文案',
          type: 'document',
          updatedAt: expect.any(Date),
        },
      ],
      travelGroup: {
        expectedMemberCount: 1,
        id: targetGroupId,
        memberCount: 1,
        readiness: 'ready',
        ready: true,
        supervisorCount: 1,
        title: '旅游服务超级群组',
        updatedAt: expect.any(Date),
      },
    });

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'ROUTE_SESSION_TOKEN_MUST_NOT_LEAK',
      'ROUTE_PASSWORD_HASH_MUST_NOT_LEAK',
      'ROUTE_MODEL_KEY_MUST_NOT_LEAK',
      'ROUTE_GROUP_CONFIG_MUST_NOT_LEAK',
      'ROUTE_GROUP_PROMPT_MUST_NOT_LEAK',
      'ROUTE_GENERATION_PROMPT_MUST_NOT_LEAK',
      'ROUTE_GENERATION_MESSAGE_MUST_NOT_LEAK',
      'ROUTE_PROVIDER_MUST_NOT_LEAK',
      'ROUTE_WORK_BODY_MUST_NOT_LEAK',
      'ROUTE_WORK_URL_MUST_NOT_LEAK',
      'ROUTE_DOCUMENT_BODY_MUST_NOT_LEAK',
      'ROUTE_DOCUMENT_METADATA_MUST_NOT_LEAK',
      'ROUTE_DOCUMENT_SOURCE_MUST_NOT_LEAK',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('returns only the target user content catalog with summary counts and stable filters', async () => {
    await db.insert(travelGenerationTasks).values([
      {
        createdAt: new Date('2026-09-01T08:00:00.000Z'),
        groupId: targetGroupId,
        id: 'platform-operations-catalog-generation-c',
        input: { prompt: 'ROUTE_CATALOG_PROMPT_C_MUST_NOT_LEAK' },
        provider: 'ROUTE_CATALOG_PROVIDER_MUST_NOT_LEAK',
        status: 'succeeded',
        type: 'copy',
        updatedAt: new Date('2026-09-02T12:00:00.000Z'),
        usage: { input: 123_456 },
        userId: targetId,
      },
      {
        createdAt: new Date('2026-09-01T07:00:00.000Z'),
        groupId: targetGroupId,
        id: 'platform-operations-catalog-generation-b',
        input: { prompt: 'ROUTE_CATALOG_PROMPT_B_MUST_NOT_LEAK' },
        message: 'ROUTE_CATALOG_INTERNAL_ERROR_MUST_NOT_LEAK',
        status: 'succeeded',
        type: 'copy',
        updatedAt: new Date('2026-09-02T12:00:00.000Z'),
        userId: targetId,
      },
      {
        createdAt: new Date('2026-09-01T09:00:00.000Z'),
        groupId: targetGroupId,
        id: 'platform-operations-catalog-generation-other',
        input: { prompt: 'ROUTE_CATALOG_OTHER_USER_MUST_NOT_LEAK' },
        status: 'succeeded',
        type: 'copy',
        updatedAt: new Date('2026-09-02T13:00:00.000Z'),
        userId: ordinaryId,
      },
    ]);

    const firstPage = await adminCaller().getUserContentCatalog({
      endAt: new Date('2026-09-02T12:30:00.000Z'),
      kind: 'generation',
      limit: 1,
      startAt: new Date('2026-09-02T11:00:00.000Z'),
      status: 'succeeded',
      targetUserId: targetId,
      type: 'copy',
    });
    expect(firstPage).toEqual({
      counts: { documents: 1, generationTasks: 3, works: 1 },
      items: [
        {
          createdAt: new Date('2026-09-01T08:00:00.000Z'),
          filename: null,
          id: 'platform-operations-catalog-generation-c',
          kind: 'generation',
          status: 'succeeded',
          title: null,
          type: 'copy',
          updatedAt: new Date('2026-09-02T12:00:00.000Z'),
        },
      ],
      nextCursor: expect.any(String),
    });
    const secondPage = await adminCaller().getUserContentCatalog({
      cursor: firstPage.nextCursor!,
      endAt: new Date('2026-09-02T12:30:00.000Z'),
      kind: 'generation',
      limit: 1,
      startAt: new Date('2026-09-02T11:00:00.000Z'),
      status: 'succeeded',
      targetUserId: targetId,
      type: 'copy',
    });
    expect(secondPage.items.map(({ id }) => id)).toEqual([
      'platform-operations-catalog-generation-b',
    ]);
    expect(secondPage.nextCursor).toBeNull();
    for (const item of [...firstPage.items, ...secondPage.items]) {
      expect(Object.keys(item).sort()).toEqual([
        'createdAt',
        'filename',
        'id',
        'kind',
        'status',
        'title',
        'type',
        'updatedAt',
      ]);
    }
    expect(JSON.stringify([firstPage, secondPage])).not.toMatch(
      /ROUTE_CATALOG_(?:PROMPT|PROVIDER|INTERNAL|OTHER)|usage|token|password/i,
    );
  });

  it('rejects invalid or unknown content catalog requests and redacts storage failures', async () => {
    const caller = adminCaller();

    await expect(
      caller.getUserContentCatalog({ kind: 'generation', limit: 0, targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.getUserContentCatalog({ kind: 'generation', limit: 51, targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.getUserContentCatalog({ cursor: 'bad-cursor', kind: 'work', targetUserId: targetId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.getUserContentCatalog({
        kind: 'document',
        status: 'completed',
        targetUserId: targetId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.getUserContentCatalog({
        kind: 'generation',
        targetUserId: 'platform-operations-route-missing',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Target user was not found' });

    const listContentCatalog = vi
      .spyOn(PlatformUserContentModel.prototype, 'listContentCatalog')
      .mockRejectedValueOnce(new Error('CONTENT_PROVIDER_KEY_MUST_NOT_LEAK'));
    const error = await caller
      .getUserContentCatalog({ kind: 'generation', targetUserId: targetId })
      .catch((cause) => cause);
    expect(error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to load platform user information. Please try again.',
    });
    expect(String(error)).not.toContain('CONTENT_PROVIDER_KEY_MUST_NOT_LEAK');
    listContentCatalog.mockRestore();
  });
});
