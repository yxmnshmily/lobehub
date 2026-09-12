// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  agentSkills,
  chatGroups,
  chatGroupsAgents,
  travelServiceAccounts,
  users,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatGroupModel } from '@/database/models/chatGroup';

import { UserService } from './index';
import {
  checkDefaultTravelServiceGroup,
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  getDefaultTravelServiceGroupHealthSummary,
  initDefaultTravelServiceGroup,
  TRAVEL_SPECIALIST_TEMPLATES,
} from './travelServiceGroup';

const authConfig = vi.hoisted(() => ({ emailVerificationRequired: true }));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    get AUTH_EMAIL_VERIFICATION() {
      return authConfig.emailVerificationRequired;
    },
  },
}));

const firstUserId = 'travel-group-concurrency-user-a';
const secondUserId = 'travel-group-concurrency-user-b';
const db: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  authConfig.emailVerificationRequired = true;
  await db.delete(users);
  await db.insert(users).values([
    { email: 'a@example.test', id: firstUserId, normalizedEmail: 'a@example.test' },
    { email: 'b@example.test', id: secondUserId, normalizedEmail: 'b@example.test' },
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(users);
});

describe('default travel service group initialization', () => {
  it('returns a safe healthy summary without changing the initialized personal group', async () => {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, firstUserId));
    await initDefaultTravelServiceGroup(db, firstUserId);

    const summary = await getDefaultTravelServiceGroupHealthSummary(db, {
      targetUserId: firstUserId,
    });

    expect(summary).toEqual({
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
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('systemRole');
    expect(serialized).not.toContain('provider');
    expect(serialized).not.toContain('apiKey');
    expect(
      await db
        .select({ id: chatGroups.id })
        .from(chatGroups)
        .where(eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID)),
    ).toHaveLength(1);
    const copywriter = await db.query.agents.findFirst({
      columns: { plugins: true },
      where: and(eq(agents.clientId, 'default-travel-copywriter'), eq(agents.userId, firstUserId)),
    });
    expect(copywriter?.plugins).toEqual(
      expect.arrayContaining(['lobe-travel-production', 'tourism-copywriting']),
    );
  });

  it('returns fixed issue codes for damaged existing resources without exposing their values', async () => {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, firstUserId));
    const group = await initDefaultTravelServiceGroup(db, firstUserId);
    if (!group) throw new Error('Expected travel group');
    const rows = await db
      .select({ agentId: agents.id, clientId: agents.clientId, role: chatGroupsAgents.role })
      .from(chatGroupsAgents)
      .innerJoin(agents, eq(agents.id, chatGroupsAgents.agentId))
      .where(eq(chatGroupsAgents.chatGroupId, group.id));
    const supervisor = rows.find(({ role }) => role === 'supervisor');
    const copywriter = rows.find(({ clientId }) => clientId === 'default-travel-copywriter');
    const designer = rows.find(({ clientId }) => clientId === 'default-travel-image-designer');
    const video = rows.find(({ clientId }) => clientId === 'default-travel-video-producer');
    if (!supervisor || !copywriter || !designer || !video) throw new Error('Expected full roster');

    await db.update(chatGroups).set({ visibility: 'public' }).where(eq(chatGroups.id, group.id));
    await db
      .update(agents)
      .set({
        agencyConfig: { modelRuntimeMode: 'actor', modelSelectionPolicy: 'member' },
        title: 'Unexpected title',
      })
      .where(eq(agents.id, supervisor.agentId));
    await db
      .update(chatGroupsAgents)
      .set({ enabled: false })
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, group.id),
          eq(chatGroupsAgents.agentId, copywriter.agentId),
        ),
      );
    await db.delete(agents).where(eq(agents.id, designer.agentId));
    await db
      .update(agents)
      .set({ agencyConfig: { modelRuntimeMode: 'actor', modelSelectionPolicy: 'fixed' } })
      .where(eq(agents.id, video.agentId));

    const summary = await getDefaultTravelServiceGroupHealthSummary(db, {
      targetUserId: firstUserId,
    });

    expect(summary).toMatchObject({
      groupCount: 1,
      healthy: false,
      isPrivate: false,
      requiredMembers: {
        'copywriter': { enabled: false, exists: true, platformManaged: true },
        'designer': { enabled: false, exists: false, platformManaged: false },
        'video-producer': { enabled: true, exists: true, platformManaged: false },
      },
      supervisor: { count: 1, platformManaged: false, titleMatches: false },
    });
    expect(summary.issueCodes).toEqual([
      'DEFAULT_GROUP_NOT_PRIVATE',
      'SUPERVISOR_TITLE_INVALID',
      'SUPERVISOR_NOT_PLATFORM_MANAGED',
      'COPYWRITER_DISABLED',
      'DESIGNER_MISSING',
      'VIDEO_PRODUCER_NOT_PLATFORM_MANAGED',
    ]);
    expect(JSON.stringify(summary)).not.toContain('Unexpected title');
  });

  it('reports drifted specialist titles and prompts as unhealthy', async () => {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, firstUserId));
    await initDefaultTravelServiceGroup(db, firstUserId);
    await db
      .update(agents)
      .set({ systemRole: '漂移的文案提示词', title: '漂移的文案助手' })
      .where(and(eq(agents.userId, firstUserId), eq(agents.clientId, 'default-travel-copywriter')));

    const summary = await getDefaultTravelServiceGroupHealthSummary(db, {
      targetUserId: firstUserId,
    });

    expect(summary.healthy).toBe(false);
    expect(summary.issueCodes).toContain('COPYWRITER_TEMPLATE_MISMATCH');
    expect(JSON.stringify(summary)).not.toContain('漂移的文案');

    await expect(new UserService(db).ensureTravelServiceReady(firstUserId)).resolves.toMatchObject({
      ready: true,
    });
    await expect(
      db.query.agents.findFirst({
        columns: { systemRole: true, title: true },
        where: and(
          eq(agents.userId, firstUserId),
          eq(agents.clientId, 'default-travel-copywriter'),
        ),
      }),
    ).resolves.toEqual({
      systemRole: '你是旅游文案助理，负责口播、攻略、标题、推文和营销脚本。',
      title: '旅游文案助理',
    });
  });

  it('keeps workspace health lookup isolated from the existing personal group', async () => {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, firstUserId));
    await initDefaultTravelServiceGroup(db, firstUserId);
    await db.insert(workspaces).values({
      id: 'travel-health-workspace',
      name: 'Travel health workspace',
      primaryOwnerId: firstUserId,
      slug: 'travel-health-workspace',
    });

    const summary = await getDefaultTravelServiceGroupHealthSummary(db, {
      targetUserId: firstUserId,
      workspaceId: 'travel-health-workspace',
    });

    expect(summary).toMatchObject({
      groupCount: 0,
      healthy: false,
      isPrivate: false,
      issueCodes: ['DEFAULT_GROUP_MISSING', 'DEFAULT_GROUP_SCOPE_INVALID'],
      supervisor: { count: 0, platformManaged: false, titleMatches: false },
    });
    expect(
      await db
        .select({ id: chatGroups.id })
        .from(chatGroups)
        .where(eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID)),
    ).toHaveLength(1);
  });

  it('keeps one private owned group per user under concurrent retries without changing user names', async () => {
    await db.update(users).set({ emailVerified: true });
    await db.insert(chatGroups).values([
      {
        clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
        content: '用户自定义群规',
        id: 'existing-travel-group',
        title: '我的旅游制作群',
        userId: firstUserId,
        visibility: 'public',
      },
      {
        id: 'unrelated-custom-group',
        title: '用户自定义群',
        userId: firstUserId,
        visibility: 'private',
      },
    ]);

    await Promise.all([
      initDefaultTravelServiceGroup(db, firstUserId),
      initDefaultTravelServiceGroup(db, firstUserId),
      initDefaultTravelServiceGroup(db, secondUserId),
      initDefaultTravelServiceGroup(db, secondUserId),
    ]);

    const managedGroups = await db
      .select()
      .from(chatGroups)
      .where(eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID));
    expect(managedGroups).toHaveLength(2);
    expect(managedGroups.filter(({ userId }) => userId === firstUserId)).toHaveLength(1);
    expect(managedGroups.filter(({ userId }) => userId === secondUserId)).toHaveLength(1);
    expect(managedGroups.every(({ visibility }) => visibility === 'private')).toBe(true);
    expect(managedGroups.find(({ userId }) => userId === firstUserId)).toMatchObject({
      content: '用户自定义群规',
      title: '我的旅游制作群',
    });
    await expect(
      db.query.chatGroups.findFirst({ where: eq(chatGroups.id, 'unrelated-custom-group') }),
    ).resolves.toMatchObject({ title: '用户自定义群', visibility: 'private' });

    const memberRows = await db
      .select({
        agentClientId: agents.clientId,
        agentSlug: agents.slug,
        agentUserId: agents.userId,
        enabled: chatGroupsAgents.enabled,
        groupId: chatGroups.id,
        groupUserId: chatGroups.userId,
        relationUserId: chatGroupsAgents.userId,
      })
      .from(chatGroupsAgents)
      .innerJoin(chatGroups, eq(chatGroups.id, chatGroupsAgents.chatGroupId))
      .innerJoin(agents, eq(agents.id, chatGroupsAgents.agentId))
      .where(eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID));
    expect(memberRows).toHaveLength(10);
    expect(
      memberRows.every(
        ({ agentUserId, enabled, groupUserId, relationUserId }) =>
          enabled === true && agentUserId === groupUserId && relationUserId === groupUserId,
      ),
    ).toBe(true);
    for (const group of managedGroups) {
      const rows = memberRows.filter(({ groupId }) => groupId === group.id);
      expect(rows.filter(({ agentSlug }) => agentSlug === 'group-supervisor')).toHaveLength(1);
      expect(
        rows
          .map(({ agentClientId }) => agentClientId)
          .filter(Boolean)
          .sort(),
      ).toEqual(TRAVEL_SPECIALIST_TEMPLATES.map(({ clientId }) => clientId).sort());
    }
  });

  it('keeps custom member slots and supervisors unchanged when login repair requires review', async () => {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, firstUserId));
    await initDefaultTravelServiceGroup(db, firstUserId);
    const group = await db.query.chatGroups.findFirst({
      where: and(
        eq(chatGroups.userId, firstUserId),
        eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
      ),
    });
    if (!group) throw new Error('Expected default group fixture');

    const [customSupervisor] = await db
      .insert(agents)
      .values({ id: 'custom-review-supervisor', title: '用户自定义主管', userId: firstUserId })
      .returning();
    await db.insert(chatGroupsAgents).values({
      agentId: customSupervisor.id,
      chatGroupId: group.id,
      enabled: true,
      order: 99,
      role: 'supervisor',
      userId: firstUserId,
    });
    const customConfig = {
      ...group.config,
      memberSlots: [
        ...(group.config?.memberSlots ?? []).map((slot) =>
          slot.key === 'copywriter' ? { ...slot, label: '我的文案席位' } : slot,
        ),
        {
          agentId: customSupervisor.id,
          configurable: true,
          key: 'custom-review-supervisor',
          label: '用户自定义主管',
          role: 'supervisor' as const,
          status: 'configured' as const,
        },
      ],
      openingMessage: '用户自定义开场白',
    };
    await db.update(chatGroups).set({ config: customConfig }).where(eq(chatGroups.id, group.id));
    const membershipsBefore = await db
      .select({
        agentId: chatGroupsAgents.agentId,
        enabled: chatGroupsAgents.enabled,
        order: chatGroupsAgents.order,
        role: chatGroupsAgents.role,
      })
      .from(chatGroupsAgents)
      .where(eq(chatGroupsAgents.chatGroupId, group.id));

    const result = await new UserService(db).ensureTravelServiceReady(firstUserId);
    const preservedGroup = await db.query.chatGroups.findFirst({
      where: eq(chatGroups.id, group.id),
    });
    const membershipsAfter = await db
      .select({
        agentId: chatGroupsAgents.agentId,
        enabled: chatGroupsAgents.enabled,
        order: chatGroupsAgents.order,
        role: chatGroupsAgents.role,
      })
      .from(chatGroupsAgents)
      .where(eq(chatGroupsAgents.chatGroupId, group.id));

    expect(result.ready).toBe(false);
    expect(preservedGroup?.config).toEqual(customConfig);
    expect(membershipsAfter).toEqual(membershipsBefore);
    await expect(
      db
        .select({ id: travelServiceAccounts.id })
        .from(travelServiceAccounts)
        .where(eq(travelServiceAccounts.userId, firstUserId)),
    ).resolves.toHaveLength(0);
  });

  it('repairs fixed member slots while preserving custom slots and supervisors on retry', async () => {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, firstUserId));
    await initDefaultTravelServiceGroup(db, firstUserId);
    const group = await db.query.chatGroups.findFirst({
      where: and(
        eq(chatGroups.userId, firstUserId),
        eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
      ),
    });
    if (!group) throw new Error('Expected default group fixture');
    const [customSupervisor] = await db
      .insert(agents)
      .values({ id: 'custom-bootstrap-supervisor', title: '自定义主管', userId: firstUserId })
      .returning();
    await db.insert(chatGroupsAgents).values({
      agentId: customSupervisor.id,
      chatGroupId: group.id,
      enabled: true,
      order: 88,
      role: 'supervisor',
      userId: firstUserId,
    });
    const customSlots = [
      ...(group.config?.memberSlots ?? []).map((slot) =>
        slot.key === 'designer' ? { ...slot, label: '我的视觉席位' } : slot,
      ),
      {
        agentId: customSupervisor.id,
        configurable: true,
        key: 'custom-bootstrap-supervisor',
        label: '自定义主管',
        role: 'supervisor' as const,
        status: 'configured' as const,
      },
    ];
    await db
      .update(chatGroups)
      .set({ config: { ...group.config, memberSlots: customSlots } })
      .where(eq(chatGroups.id, group.id));

    await initDefaultTravelServiceGroup(db, firstUserId);

    const retried = await db.query.chatGroups.findFirst({ where: eq(chatGroups.id, group.id) });
    const customMembership = await db.query.chatGroupsAgents.findFirst({
      where: and(
        eq(chatGroupsAgents.chatGroupId, group.id),
        eq(chatGroupsAgents.agentId, customSupervisor.id),
      ),
    });
    expect(retried?.config?.memberSlots).toEqual(
      customSlots.map((slot) =>
        slot.key === 'designer' ? { ...slot, label: '图片封面助理' } : slot,
      ),
    );
    expect(customMembership).toMatchObject({ order: 88, role: 'supervisor' });
  });

  it('migrates the recognizable legacy Inbox supervisor through the safe login plan', async () => {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, firstUserId));
    await initDefaultTravelServiceGroup(db, firstUserId);
    const group = await db.query.chatGroups.findFirst({
      where: and(
        eq(chatGroups.userId, firstUserId),
        eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
      ),
    });
    const supervisor = await db.query.agents.findFirst({
      where: and(eq(agents.userId, firstUserId), eq(agents.slug, 'group-supervisor')),
    });
    const inbox = await db.query.agents.findFirst({
      where: and(eq(agents.userId, firstUserId), eq(agents.slug, 'inbox')),
    });
    if (!group || !supervisor || !inbox) throw new Error('Expected legacy migration fixtures');
    await db
      .delete(chatGroupsAgents)
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, group.id),
          eq(chatGroupsAgents.agentId, supervisor.id),
        ),
      );
    await db.insert(chatGroupsAgents).values({
      agentId: inbox.id,
      chatGroupId: group.id,
      enabled: true,
      order: 0,
      role: 'supervisor',
      userId: firstUserId,
    });

    const result = await new UserService(db).ensureTravelServiceReady(firstUserId);
    const supervisors = await db
      .select({ agentId: chatGroupsAgents.agentId })
      .from(chatGroupsAgents)
      .where(
        and(eq(chatGroupsAgents.chatGroupId, group.id), eq(chatGroupsAgents.role, 'supervisor')),
      );

    expect(result.ready).toBe(true);
    expect(supervisors).toEqual([{ agentId: supervisor.id }]);
    await expect(
      db.query.chatGroupsAgents.findFirst({
        where: and(
          eq(chatGroupsAgents.chatGroupId, group.id),
          eq(chatGroupsAgents.agentId, inbox.id),
        ),
      }),
    ).resolves.toBeUndefined();
  });

  it('rolls back a late membership failure and succeeds cleanly on retry', async () => {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, firstUserId));
    vi.spyOn(ChatGroupModel.prototype, 'ensureParticipantAgents').mockRejectedValueOnce(
      new Error('simulated late membership failure'),
    );

    await expect(initDefaultTravelServiceGroup(db, firstUserId)).rejects.toThrow(
      'simulated late membership failure',
    );

    expect(
      await db
        .select({ id: chatGroups.id })
        .from(chatGroups)
        .where(
          and(
            eq(chatGroups.userId, firstUserId),
            eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.userId, firstUserId),
            inArray(
              agents.clientId,
              TRAVEL_SPECIALIST_TEMPLATES.map(({ clientId }) => clientId),
            ),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: agentSkills.id })
        .from(agentSkills)
        .where(eq(agentSkills.userId, firstUserId)),
    ).toHaveLength(0);

    vi.restoreAllMocks();
    await initDefaultTravelServiceGroup(db, firstUserId);

    const [recoveredGroup] = await db
      .select({ id: chatGroups.id, visibility: chatGroups.visibility })
      .from(chatGroups)
      .where(
        and(
          eq(chatGroups.userId, firstUserId),
          eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
        ),
      );
    expect(recoveredGroup?.visibility).toBe('private');
    expect(
      await db
        .select({ agentId: chatGroupsAgents.agentId })
        .from(chatGroupsAgents)
        .where(eq(chatGroupsAgents.chatGroupId, recoveredGroup.id)),
    ).toHaveLength(5);
  });

  it('does not create a consumable group before email verification', async () => {
    await Promise.all([
      initDefaultTravelServiceGroup(db, firstUserId),
      initDefaultTravelServiceGroup(db, secondUserId),
    ]);

    expect(
      await db
        .select({ id: chatGroups.id })
        .from(chatGroups)
        .where(eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.userId, firstUserId),
            inArray(
              agents.clientId,
              TRAVEL_SPECIALIST_TEMPLATES.map(({ clientId }) => clientId),
            ),
          ),
        ),
    ).toHaveLength(0);
  });

  it('creates and restores the private group before verification when verification is disabled', async () => {
    authConfig.emailVerificationRequired = false;

    const created = await initDefaultTravelServiceGroup(db, firstUserId);
    expect(created).toMatchObject({ visibility: 'private' });
    await expect(checkDefaultTravelServiceGroup(db, firstUserId)).resolves.toMatchObject({
      accessState: 'active',
      memberCount: 5,
      ready: true,
    });

    await db.update(chatGroups).set({ visibility: 'public' }).where(eq(chatGroups.id, created!.id));
    await new UserService(db).ensureTravelServiceReady(firstUserId);

    await expect(checkDefaultTravelServiceGroup(db, firstUserId)).resolves.toMatchObject({
      groupId: created!.id,
      groupVisibility: 'private',
      ready: true,
    });
  });

  it('uses the health supervisor diagnostic when deciding real readiness', async () => {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, firstUserId));
    const group = await initDefaultTravelServiceGroup(db, firstUserId);
    if (!group) throw new Error('Expected travel group');
    const supervisor = await db.query.chatGroupsAgents.findFirst({
      where: and(
        eq(chatGroupsAgents.chatGroupId, group.id),
        eq(chatGroupsAgents.role, 'supervisor'),
      ),
    });
    if (!supervisor) throw new Error('Expected supervisor fixture');
    await db
      .update(chatGroupsAgents)
      .set({ enabled: false })
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, group.id),
          eq(chatGroupsAgents.agentId, supervisor.agentId),
        ),
      );

    await expect(
      getDefaultTravelServiceGroupHealthSummary(db, { targetUserId: firstUserId }),
    ).resolves.toMatchObject({ healthy: false, issueCodes: ['SUPERVISOR_DISABLED'] });
    await expect(checkDefaultTravelServiceGroup(db, firstUserId)).resolves.toMatchObject({
      ready: false,
    });
  });

  it('keeps health and readiness aligned for every specialist skill and tool binding', async () => {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, firstUserId));
    await initDefaultTravelServiceGroup(db, firstUserId);
    const cases = [
      {
        clientId: 'default-travel-copywriter',
        issueCode: 'COPYWRITER_SKILL_BINDING_MISSING',
        kind: 'skill',
        plugin: 'tourism-copywriting',
      },
      {
        clientId: 'default-travel-copywriter',
        issueCode: 'COPYWRITER_TOOL_BINDING_MISSING',
        kind: 'tool',
        plugin: 'lobe-travel-production',
      },
      {
        clientId: 'default-travel-image-designer',
        issueCode: 'DESIGNER_SKILL_BINDING_MISSING',
        kind: 'skill',
        plugin: 'tourism-visual-design',
      },
      {
        clientId: 'default-travel-image-designer',
        issueCode: 'DESIGNER_TOOL_BINDING_MISSING',
        kind: 'tool',
        plugin: 'lobe-travel-production',
      },
      {
        clientId: 'default-travel-video-producer',
        issueCode: 'VIDEO_PRODUCER_SKILL_BINDING_MISSING',
        kind: 'skill',
        plugin: 'tourism-video-production',
      },
      {
        clientId: 'default-travel-video-producer',
        issueCode: 'VIDEO_PRODUCER_TOOL_BINDING_MISSING',
        kind: 'tool',
        plugin: 'lobe-travel-production',
      },
      {
        clientId: 'default-travel-document-assistant',
        issueCode: 'DOCUMENT_ASSISTANT_SKILL_BINDING_MISSING',
        kind: 'skill',
        plugin: 'tourism-document-production',
      },
      {
        clientId: 'default-travel-document-assistant',
        issueCode: 'DOCUMENT_ASSISTANT_TOOL_BINDING_MISSING',
        kind: 'tool',
        plugin: 'lobe-agent-documents',
      },
    ] as const;

    for (const testCase of cases) {
      const specialist = await db.query.agents.findFirst({
        columns: { id: true, plugins: true },
        where: and(eq(agents.userId, firstUserId), eq(agents.clientId, testCase.clientId)),
      });
      if (!specialist) throw new Error(`Expected specialist ${testCase.clientId}`);
      const originalPlugins = specialist.plugins ?? [];
      await db
        .update(agents)
        .set({ plugins: originalPlugins.filter((plugin) => plugin !== testCase.plugin) })
        .where(eq(agents.id, specialist.id));

      const health = await getDefaultTravelServiceGroupHealthSummary(db, {
        targetUserId: firstUserId,
      });
      const readiness = await checkDefaultTravelServiceGroup(db, firstUserId);

      expect(health.issueCodes).toContain(testCase.issueCode);
      expect(readiness.ready).toBe(false);
      if (testCase.kind === 'skill') {
        expect(readiness.missingSkillBindings).toContain(testCase.plugin);
      } else {
        expect(readiness.missingToolBindings).toContain(testCase.plugin);
      }

      await db.update(agents).set({ plugins: originalPlugins }).where(eq(agents.id, specialist.id));
    }
  });

  it('keeps a banned users group unavailable and reuses it after account recovery', async () => {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, firstUserId));
    const created = await initDefaultTravelServiceGroup(db, firstUserId);
    await db.update(users).set({ banned: true }).where(eq(users.id, firstUserId));

    const banned = await checkDefaultTravelServiceGroup(db, firstUserId);
    expect(banned).toMatchObject({
      accessState: 'banned',
      groupId: created?.id,
      memberCount: 5,
      ready: false,
      supervisorCount: 1,
    });
    await expect(initDefaultTravelServiceGroup(db, firstUserId)).resolves.toBeNull();
    expect(
      await db
        .select({ id: chatGroups.id })
        .from(chatGroups)
        .where(
          and(
            eq(chatGroups.userId, firstUserId),
            eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
          ),
        ),
    ).toHaveLength(1);

    await db.update(users).set({ banned: false }).where(eq(users.id, firstUserId));
    await Promise.all([
      initDefaultTravelServiceGroup(db, firstUserId),
      initDefaultTravelServiceGroup(db, firstUserId),
    ]);
    const recovered = await checkDefaultTravelServiceGroup(db, firstUserId);
    expect(recovered).toMatchObject({
      accessState: 'active',
      groupId: created?.id,
      memberCount: 5,
      ready: true,
      supervisorCount: 1,
    });
    expect(
      await db
        .select({ id: chatGroups.id })
        .from(chatGroups)
        .where(
          and(
            eq(chatGroups.userId, firstUserId),
            eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
          ),
        ),
    ).toHaveLength(1);
  });
});
