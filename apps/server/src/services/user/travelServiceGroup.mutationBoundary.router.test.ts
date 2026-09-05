// @vitest-environment node
import { agents, chatGroups, chatGroupsAgents, users } from '@lobechat/database/schemas';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import * as AgentModelModule from '@/database/models/agent';
import * as ChatGroupModelModule from '@/database/models/chatGroup';
import * as AgentGroupRepoModule from '@/database/repositories/agentGroup';
import * as AgentServiceModule from '@/server/services/agent';
import * as AgentGroupServiceModule from '@/server/services/agentGroup';

import { agentRouter } from '../../routers/lambda/agent';
import { agentGroupRouter } from '../../routers/lambda/agentGroup';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from './travelServiceGroup';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/server/services/resourcePermission', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    assertCanEditResource: vi.fn(),
    assertCanPerformResourceAction: vi.fn(),
  };
});

const db = await getTestDB();
const ownerId = 'travel-route-guard-owner';
const attackerId = 'travel-route-guard-attacker';
const defaultGroupId = 'travel-route-guard-default-group';
const customGroupId = 'travel-route-guard-custom-group';
const supervisorId = 'travel-route-guard-supervisor';
const customAgentId = 'travel-route-guard-custom-agent';
const ordinaryMemberId = 'travel-route-guard-ordinary-member';

const callerContext = (userId = ownerId) => ({ serverDB: db, userId }) as any;

const deleteGroup = vi.spyOn(AgentGroupServiceModule.AgentGroupService.prototype, 'deleteGroup');
const removeAgentsFromGroup = vi.spyOn(
  AgentGroupRepoModule.AgentGroupRepository.prototype,
  'removeAgentsFromGroup',
);
const publishGroup = vi.spyOn(ChatGroupModelModule.ChatGroupModel.prototype, 'publishToWorkspace');
const updateGroup = vi.spyOn(ChatGroupModelModule.ChatGroupModel.prototype, 'update');
const updateAgentInGroup = vi.spyOn(
  ChatGroupModelModule.ChatGroupModel.prototype,
  'updateAgentInGroup',
);
const deleteAgent = vi.fn();
const transferAgents = vi.fn();
const updateAgentSlug = vi.fn();
vi.spyOn(AgentModelModule, 'AgentModel').mockImplementation(
  () =>
    ({
      delete: deleteAgent,
      existsById: vi.fn().mockResolvedValue(true),
      transferAgents,
      updateSlug: updateAgentSlug,
    }) as unknown as AgentModelModule.AgentModel,
);
const updateAgentConfig = vi.spyOn(AgentServiceModule.AgentService.prototype, 'updateAgentConfig');

beforeAll(async () => {
  await db.insert(users).values([
    { email: 'travel-route-owner@example.test', emailVerified: true, id: ownerId },
    { email: 'travel-route-attacker@example.test', emailVerified: true, id: attackerId },
  ]);
  await db.insert(chatGroups).values([
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: defaultGroupId,
      title: '旅游制作群',
      userId: ownerId,
      visibility: 'private',
    },
    { id: customGroupId, title: '旅游制作群', userId: ownerId, visibility: 'private' },
  ]);
  await db.insert(agents).values([
    {
      agencyConfig: { modelRuntimeMode: 'platform-managed', modelSelectionPolicy: 'fixed' },
      id: supervisorId,
      slug: 'group-supervisor',
      title: '旅游群主AI',
      userId: ownerId,
      virtual: true,
    },
    { id: customAgentId, slug: 'my-own-agent', title: '旅游群主AI', userId: ownerId },
    { id: ordinaryMemberId, slug: 'ordinary-member', title: '普通助手', userId: ownerId },
  ]);
  await db.insert(chatGroupsAgents).values({
    agentId: supervisorId,
    chatGroupId: defaultGroupId,
    role: 'supervisor',
    userId: ownerId,
  });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, ownerId));
  await db.delete(users).where(eq(users.id, attackerId));
});

beforeEach(() => {
  vi.clearAllMocks();
  deleteGroup.mockResolvedValue({
    deletedVirtualAgentIds: [],
    group: { id: customGroupId },
  } as any);
  removeAgentsFromGroup.mockResolvedValue({ deletedVirtualAgentIds: [], removedFromGroup: 1 });
  publishGroup.mockResolvedValue({ id: defaultGroupId } as any);
  updateGroup.mockResolvedValue({ id: customGroupId } as any);
  updateAgentInGroup.mockResolvedValue({ agentId: ordinaryMemberId } as any);
  deleteAgent.mockResolvedValue({} as any);
  transferAgents.mockResolvedValue([] as any);
  updateAgentSlug.mockResolvedValue({ id: customAgentId } as any);
  updateAgentConfig.mockResolvedValue({ agent: {}, success: true } as any);
});

describe('default travel service route mutation boundary', () => {
  it('blocks direct and batch agent mutations before their bottom writes', async () => {
    const caller = agentRouter.createCaller(callerContext());
    const calls = [
      () => caller.removeAgent({ agentId: supervisorId }),
      () => caller.updateAgentConfig({ agentId: supervisorId, value: { model: 'other' } }),
      () => caller.updateAgentSlug({ agentId: supervisorId, slug: 'renamed' }),
      () =>
        caller.transferAgents({ agentIds: [customAgentId, supervisorId], targetWorkspaceId: null }),
    ];

    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(deleteAgent).not.toHaveBeenCalled();
    expect(updateAgentConfig).not.toHaveBeenCalled();
    expect(updateAgentSlug).not.toHaveBeenCalled();
    expect(transferAgents).not.toHaveBeenCalled();
  });

  it('blocks a forged cross-user protected id at the same route boundary', async () => {
    await expect(
      agentRouter.createCaller(callerContext(attackerId)).removeAgent({ agentId: supervisorId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(deleteAgent).not.toHaveBeenCalled();
  });

  it('blocks ordinary customers from editing a same-title user-created agent', async () => {
    await expect(
      agentRouter
        .createCaller(callerContext())
        .updateAgentConfig({ agentId: customAgentId, value: { title: '我的旅游助手' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(updateAgentConfig).not.toHaveBeenCalled();
  });

  it('blocks default-group delete, publish and update before bottom writes', async () => {
    const caller = agentGroupRouter.createCaller(callerContext());
    const calls = [
      () => caller.deleteGroup({ id: defaultGroupId }),
      () => caller.publishGroupToWorkspace({ id: defaultGroupId }),
      () => caller.updateGroup({ id: defaultGroupId, value: { title: '改名' } }),
    ];

    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(deleteGroup).not.toHaveBeenCalled();
    expect(publishGroup).not.toHaveBeenCalled();
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it('blocks supervisor removal and replacement before member writes', async () => {
    const caller = agentGroupRouter.createCaller(callerContext());
    await expect(
      caller.addAgentsToGroup({ agentIds: [ordinaryMemberId], groupId: defaultGroupId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.batchCreateAgentsInGroup({
        agents: [{ title: '新成员' }],
        groupId: defaultGroupId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.removeAgentsFromGroup({ agentIds: [supervisorId], groupId: defaultGroupId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.updateAgentInGroup({
        agentId: ordinaryMemberId,
        groupId: defaultGroupId,
        updates: { role: 'supervisor' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(removeAgentsFromGroup).not.toHaveBeenCalled();
    expect(updateAgentInGroup).not.toHaveBeenCalled();
  });

  it('blocks ordinary customers from editing user-created groups and members', async () => {
    const caller = agentGroupRouter.createCaller(callerContext());
    await expect(
      caller.updateGroup({ id: customGroupId, value: { title: '我的群' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.updateAgentInGroup({
        agentId: ordinaryMemberId,
        groupId: customGroupId,
        updates: { enabled: false },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(updateGroup).not.toHaveBeenCalled();
    expect(updateAgentInGroup).not.toHaveBeenCalled();
  });
});
