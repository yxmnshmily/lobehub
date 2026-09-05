// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { agents, chatGroups, roles, userRoles, users } from '@/database/schemas';

import { agentRouter } from '../agent';
import { agentGroupRouter } from '../agentGroup';
import { agentSkillsRouter } from '../agentSkills';
import { aiModelRouter } from '../aiModel';
import { aiProviderRouter } from '../aiProvider';
import { apiKeyRouter } from '../apiKey';
import { oauthAppRouter } from '../oauthApp';
import { oauthDeviceFlowRouter } from '../oauthDeviceFlow';
import { pluginRouter } from '../plugin';
import { resourcePermissionRouter } from '../resourcePermission';
import { userRouter } from '../user';

vi.mock('@lobechat/builtin-agents', () => ({
  BUILTIN_AGENTS: {},
  BUILTIN_AGENT_SLUGS: { groupSupervisor: 'group-supervisor' },
  GROUP_SUPERVISOR: { slug: 'group-supervisor' },
}));
vi.mock('@lobechat/builtin-tool-travel-production', () => ({
  TravelProductionIdentifier: 'travel-production',
}));
vi.mock('@lobechat/builtin-tools', () => ({ builtinTools: [], manualModeExcludeToolIds: [] }));

const db = await getTestDB();
const ordinaryId = 'platform-route-ordinary';
const adminId = 'platform-route-admin';
const expiredId = 'platform-route-expired';

const agentMutationNames = [
  'acquireAgentLock',
  'createAgent',
  'createAgentFiles',
  'createAgentKnowledgeBase',
  'createAgentOnly',
  'deleteAgentFile',
  'deleteAgentKnowledgeBase',
  'duplicateAgent',
  'prioritizeTransferTopic',
  'publishAgentToWorkspace',
  'releaseAgentLock',
  'removeAgent',
  'setAgentVisibility',
  'toggleFile',
  'toggleKnowledgeBase',
  'transferAgent',
  'transferAgents',
  'updateAgentConfig',
  'updateAgentPinned',
  'updateAgentSlug',
] as const;

const agentGroupMutationNames = [
  'acquireGroupLock',
  'addAgentsToGroup',
  'batchCreateAgentsInGroup',
  'createGroup',
  'createGroupWithMembers',
  'deleteGroup',
  'duplicateGroup',
  'publishGroupToWorkspace',
  'releaseGroupLock',
  'removeAgentsFromGroup',
  'setGroupVisibility',
  'transferGroup',
  'updateAgentInGroup',
  'updateGroup',
] as const;

const create = vi.fn().mockResolvedValue({ clientSecret: 'secret', id: 'client-1', name: 'App' });
const findOidcClientById = vi
  .fn()
  .mockResolvedValue({ clientSecret: 'secret', id: 'client-1', name: 'App' });
const listOidcClients = vi
  .fn()
  .mockResolvedValue([{ clientSecret: 'secret', id: 'client-1', name: 'App' }]);
const createPlugin = vi.fn().mockResolvedValue({ identifier: 'plugin-1' });
const queryPlugins = vi.fn().mockResolvedValue([{ identifier: 'plugin-1' }]);
const updateSetting = vi.fn().mockResolvedValue({ rowCount: 1 });
const deleteSetting = vi.fn().mockResolvedValue({ rowCount: 1 });
const mergeToolInterventionSetting = vi.fn().mockResolvedValue({ rowCount: 1 });
const replaceUninstalledBuiltinToolsSetting = vi.fn().mockResolvedValue({ rowCount: 1 });
const updateGuide = vi.fn().mockResolvedValue({ rowCount: 1 });
const updatePreference = vi.fn().mockResolvedValue({ rowCount: 1 });
const updateUser = vi.fn().mockResolvedValue({ rowCount: 1 });
const getUserSettingsDefaultAgentConfig = vi.fn().mockResolvedValue({});

let ordinaryAgentId = '';
let ordinaryGroupId = '';
let adminAgentId = '';
let adminGroupId = '';

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  return { wsCompatProcedure: authedProcedure };
});
vi.mock('@/database/models/oidcClient', () => ({
  OidcClientModel: vi.fn(() => ({
    create,
    findById: findOidcClientById,
    list: listOidcClients,
  })),
}));
vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn(() => ({ create: createPlugin, query: queryPlugins })),
}));
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({
    deleteSetting,
    getUserSettingsDefaultAgentConfig,
    mergeToolInterventionSetting,
    replaceUninstalledBuiltinToolsSetting,
    updateGuide,
    updatePreference,
    updateSetting,
    updateUser,
  })),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue({ encrypt: vi.fn() }) },
}));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

const callCreate = (userId: string, workspaceRole?: 'admin') =>
  oauthAppRouter
    .createCaller({ serverDB: db, userId, workspaceRole } as any)
    .create({ name: 'App' });

beforeAll(async () => {
  await db.insert(users).values([{ id: ordinaryId }, { id: adminId }, { id: expiredId }]);
  const [role] = await db
    .insert(roles)
    .values({ displayName: 'Super Admin', isActive: true, name: 'super_admin' })
    .returning();
  await db.insert(userRoles).values([
    { roleId: role.id, userId: adminId },
    { expiresAt: new Date(Date.now() - 60_000), roleId: role.id, userId: expiredId },
  ]);

  const ordinaryAgentModel = new AgentModel(db, ordinaryId);
  const ordinaryGroupModel = new ChatGroupModel(db, ordinaryId);
  const adminAgentModel = new AgentModel(db, adminId);
  const adminGroupModel = new ChatGroupModel(db, adminId);
  ordinaryAgentId = (
    await ordinaryAgentModel.ensureByClientId('default-travel-copywriter', {
      model: 'platform-model',
      provider: 'openai',
      systemRole: '旅游群主系统提示词',
      title: '旅游群主AI',
    })
  ).id;
  ordinaryGroupId = (
    await ordinaryGroupModel.ensureByClientId({
      clientId: 'default-travel-service-group',
      content: '旅游群主编排提示词',
      title: 'Managed ordinary group',
    })
  ).id;
  adminAgentId = (
    await adminAgentModel.ensureByClientId('default-travel-copywriter', {
      title: 'Managed admin agent',
    })
  ).id;
  adminGroupId = (
    await adminGroupModel.ensureByClientId({
      clientId: 'default-travel-service-group',
      title: 'Managed admin group',
    })
  ).id;
});

beforeEach(() => {
  create.mockClear();
  deleteSetting.mockClear();
  mergeToolInterventionSetting.mockClear();
  replaceUninstalledBuiltinToolsSetting.mockClear();
  updateGuide.mockClear();
  updatePreference.mockClear();
  updateSetting.mockClear();
  updateUser.mockClear();
});

afterAll(async () => {
  await db.delete(chatGroups).where(eq(chatGroups.userId, ordinaryId));
  await db.delete(chatGroups).where(eq(chatGroups.userId, adminId));
  await db.delete(agents).where(eq(agents.userId, ordinaryId));
  await db.delete(agents).where(eq(agents.userId, adminId));
  await db.delete(userRoles).where(eq(userRoles.userId, adminId));
  await db.delete(userRoles).where(eq(userRoles.userId, expiredId));
  await db.delete(roles).where(eq(roles.name, 'super_admin'));
  await db.delete(users).where(eq(users.id, ordinaryId));
  await db.delete(users).where(eq(users.id, adminId));
  await db.delete(users).where(eq(users.id, expiredId));
});

describe('platform settings route authorization', () => {
  it('rejects an ordinary customer and a workspace admin', async () => {
    await expect(callCreate(ordinaryId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callCreate(ordinaryId, 'admin')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects unguarded skill-plugin and provider OAuth write attempts', async () => {
    const ctx = { serverDB: db, userId: ordinaryId } as any;

    await expect(
      pluginRouter.createCaller(ctx).createPlugin({
        identifier: 'plugin-1',
        type: 'plugin',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      oauthDeviceFlowRouter.createCaller(ctx).initiateDeviceCode({ providerId: 'githubcopilot' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      agentSkillsRouter.createCaller(ctx).delete({ id: 'tourism-copywriting' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(createPlugin).not.toHaveBeenCalled();
  });

  it('rejects direct reads of platform API keys and provider credentials', async () => {
    const ctx = { serverDB: db, userId: ordinaryId } as any;

    await expect(apiKeyRouter.createCaller(ctx).getApiKeys()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      aiProviderRouter.createCaller(ctx).getAiProviderById({ id: 'openai' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(aiProviderRouter.createCaller(ctx).getAiProviderList()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('keeps runtime model, skill, and plugin reads available without exposing admin records', async () => {
    const ctx = { serverDB: db, userId: ordinaryId } as any;

    await expect(
      aiModelRouter.createCaller(ctx).getAiModelById({ id: 'platform-model' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      aiModelRouter
        .createCaller(ctx)
        .getAiModelReasoningConfig({ id: 'platform-model', providerId: 'openai' }),
    ).resolves.toBeUndefined();
    await expect(agentSkillsRouter.createCaller(ctx).list()).resolves.toEqual({ data: [], total: 0 });
    await expect(pluginRouter.createCaller(ctx).getPlugins()).resolves.toEqual([
      { identifier: 'plugin-1' },
    ]);
    await expect(oauthAppRouter.createCaller(ctx).list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      oauthAppRouter.createCaller(ctx).getById({ id: 'client-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      oauthDeviceFlowRouter.createCaller(ctx).getAuthStatus({ providerId: 'githubcopilot' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps configured agents and groups readable for existing customer execution', async () => {
    const ctx = { serverDB: db, userId: ordinaryId } as any;

    await expect(
      agentRouter.createCaller(ctx).getAgentConfigById({ agentId: ordinaryAgentId }),
    ).resolves.toMatchObject({ id: ordinaryAgentId });
    await expect(
      agentGroupRouter.createCaller(ctx).getGroup({ id: ordinaryGroupId }),
    ).resolves.toMatchObject({ id: ordinaryGroupId });
    await expect(
      agentGroupRouter.createCaller(ctx).getGroupAgents({ groupId: ordinaryGroupId }),
    ).resolves.toEqual(expect.any(Array));
  });

  it('rejects direct mutations of the managed travel group and agents', async () => {
    const ctx = { serverDB: db, userId: ordinaryId } as any;

    await expect(
      agentRouter.createCaller(ctx).updateAgentConfig({
        agentId: ordinaryAgentId,
        value: {
          model: 'attacker-model',
          plugins: [],
          provider: 'attacker-provider',
          systemRole: 'attacker-system-prompt',
        },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      agentGroupRouter.createCaller(ctx).updateGroup({
        id: ordinaryGroupId,
        value: { content: 'attacker-group-prompt', title: 'Attacker title' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      agentGroupRouter.createCaller(ctx).removeAgentsFromGroup({
        agentIds: [ordinaryAgentId],
        groupId: ordinaryGroupId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const [agentAfter] = await db
      .select({ model: agents.model, provider: agents.provider, systemRole: agents.systemRole })
      .from(agents)
      .where(eq(agents.id, ordinaryAgentId));
    const [groupAfter] = await db
      .select({ content: chatGroups.content, title: chatGroups.title })
      .from(chatGroups)
      .where(eq(chatGroups.id, ordinaryGroupId));
    expect(agentAfter).toEqual({
      model: 'platform-model',
      provider: 'openai',
      systemRole: '旅游群主系统提示词',
    });
    expect(groupAfter).toEqual({
      content: '旅游群主编排提示词',
      title: 'Managed ordinary group',
    });
  });

  it('rejects ordinary-customer creation of a platform API key', async () => {
    await expect(
      apiKeyRouter
        .createCaller({ serverDB: db, userId: ordinaryId } as any)
        .createApiKey({ name: 'Attacker key', scopes: null }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects ordinary-customer creation of any agent or agent group', async () => {
    const ctx = { serverDB: db, userId: ordinaryId } as any;

    await expect(
      agentRouter.createCaller(ctx).createAgent({ config: { title: 'Unauthorized agent' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      agentGroupRouter.createCaller(ctx).createGroup({ title: 'Unauthorized group' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      agentRouter.createCaller(ctx).transferAgent({
        agentId: ordinaryAgentId,
        targetMemberId: 'recipient-1',
        targetWorkspaceId: null,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      agentGroupRouter.createCaller(ctx).transferGroup({
        groupId: ordinaryGroupId,
        targetMemberId: 'recipient-1',
        targetWorkspaceId: null,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps the complete agent and group mutation surface behind platform-admin access', async () => {
    const agentMutations = Object.entries(agentRouter._def.procedures)
      .filter(([, procedure]) => (procedure as any)._def.type === 'mutation')
      .map(([name]) => name)
      .sort();
    const groupMutations = Object.entries(agentGroupRouter._def.procedures)
      .filter(([, procedure]) => (procedure as any)._def.type === 'mutation')
      .map(([name]) => name)
      .sort();
    expect(agentMutations).toEqual([...agentMutationNames].sort());
    expect(groupMutations).toEqual([...agentGroupMutationNames].sort());

    const ctx = { serverDB: db, userId: ordinaryId } as any;
    const agentCaller = agentRouter.createCaller(ctx) as any;
    const groupCaller = agentGroupRouter.createCaller(ctx) as any;
    for (const name of agentMutationNames) {
      await expect(agentCaller[name](undefined)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    for (const name of agentGroupMutationNames) {
      await expect(groupCaller[name](undefined)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('rejects ordinary-customer permission changes on agent resources', async () => {
    await expect(
      resourcePermissionRouter
        .createCaller({ serverDB: db, userId: ordinaryId, workspaceId: 'workspace-1' } as any)
        .setGeneralAccess({ accessLevel: 'edit', resourceId: 'agent-1', resourceType: 'agent' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects managed model and credential settings while keeping personal preferences writable', async () => {
    const caller = userRouter.createCaller({ serverDB: db, userId: ordinaryId } as any);

    await expect(
      caller.updateSettings({ defaultAgent: { model: 'attacker-model' } } as any),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.updateSettings({ keyVaults: { openai: { apiKey: 'attacker-key' } } } as any),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.updatePreference({ lab: { enableGroupChat: true } })).resolves.toEqual({
      rowCount: 1,
    });
    await expect(caller.updateSettings({ general: { language: 'zh-CN' } })).resolves.toEqual({
      rowCount: 1,
    });
    await expect(caller.updateToolIntervention({ approvalMode: 'auto-run' })).resolves.toEqual({
      rowCount: 1,
    });
    await expect(caller.resetSettings()).resolves.toEqual({ rowCount: 1 });
    await expect(caller.updateGuide({ topic: true })).resolves.toEqual({ rowCount: 1 });
    await expect(
      caller.updateUninstalledBuiltinTools({
        uninstalledBuiltinTools: ['lobe-image-generation'],
        workspaceId: null,
      }),
    ).resolves.toEqual({ rowCount: 1 });
    expect(updateSetting).toHaveBeenCalledWith({ general: { language: 'zh-CN' } });
  });

  it('keeps explicit customer profile writes available', async () => {
    await expect(
      userRouter
        .createCaller({ serverDB: db, userId: ordinaryId } as any)
        .updateFullName('Customer Name'),
    ).resolves.toEqual({ rowCount: 1 });
    expect(updateUser).toHaveBeenCalledWith({ fullName: 'Customer Name' });
  });

  it('allows an active global super_admin', async () => {
    await expect(callCreate(adminId)).resolves.toEqual({ id: 'client-1', name: 'App' });
    expect(create).toHaveBeenCalledOnce();

    const ctx = { serverDB: db, userId: adminId } as any;
    await expect(
      agentRouter.createCaller(ctx).updateAgentPinned({ id: adminAgentId, pinned: true }),
    ).resolves.toBeDefined();
    await expect(
      agentGroupRouter.createCaller(ctx).updateGroup({
        id: adminGroupId,
        value: { title: 'Managed by platform admin' },
      }),
    ).resolves.toBeDefined();
    await expect(
      userRouter
        .createCaller(ctx)
        .updateSettings({ systemAgent: { topic: { model: 'admin-model' } } }),
    ).resolves.toEqual({ rowCount: 1 });
    await expect(
      agentRouter.createCaller(ctx).createAgent({ config: { title: 'Admin-created agent' } }),
    ).resolves.toMatchObject({ agentId: expect.any(String) });
    await expect(
      agentGroupRouter.createCaller(ctx).createGroup({ title: 'Admin-created group' }),
    ).resolves.toMatchObject({ group: { title: 'Admin-created group' } });
    expect(updateSetting).toHaveBeenCalledOnce();
  });

  it('rejects expired and disabled global roles', async () => {
    const activeRole = await db.query.roles.findFirst({ where: eq(roles.name, 'super_admin') });
    if (!activeRole) throw new Error('test role is missing');
    await expect(callCreate(expiredId)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await db.update(roles).set({ isActive: false }).where(eq(roles.id, activeRole.id));
    await expect(callCreate(adminId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
