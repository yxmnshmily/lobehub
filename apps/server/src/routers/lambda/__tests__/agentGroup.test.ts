// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import * as AgentModelModule from '@/database/models/agent';
import * as ChatGroupModelModule from '@/database/models/chatGroup';
import * as ResourcePermissionModelModule from '@/database/models/resourcePermission';
import * as ResourceTransferRequestModelModule from '@/database/models/resourceTransferRequest';
import { TRANSFER_REQUEST_ALREADY_PENDING } from '@/database/models/resourceTransferRequest';
import * as UserModelModule from '@/database/models/user';
import * as AgentGroupRepoModule from '@/database/repositories/agentGroup';
import * as ChatGroupServiceModule from '@/server/services/agentGroup';
import { EditLockService } from '@/server/services/editLock';
import { publishResourceEvent } from '@/server/services/resourceEvents';
import { canPerformResourceAction } from '@/server/services/resourcePermission';
import {
  hasWorkspaceScopedPermission,
  isWorkspacePrimaryOwner,
} from '@/server/services/workspacePermission';

import { hasActivePlatformAdminAccess } from '../_helpers/platformAdminGuard';
import {
  getWorkspaceAgentParentGroupIds,
  getWorkspaceGroupVirtualAgentIds,
} from '../_helpers/workspaceAgentGuard';
import { agentGroupRouter } from '../agentGroup';

const profileBackfill = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const defaultTravelServiceMutationGuard = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const reservedTravelServiceIdentityGuard = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/user/travelServiceGroup', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  backfillDefaultTravelGroupSupervisorProfile: profileBackfill,
}));
vi.mock('@/server/services/user/travelServiceGroupMutationGuard', () => ({
  assertDefaultTravelServiceMutationAllowed: defaultTravelServiceMutationGuard,
  assertNoReservedTravelServiceIdentity: reservedTravelServiceIdentityGuard,
}));

vi.mock('@/server/services/resourceEvents', () => ({ publishResourceEvent: vi.fn() }));
// Both read the DB directly; `mockCtx.serverDB` is a bare object.
vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: vi.fn().mockResolvedValue(true),
  isWorkspacePrimaryOwner: vi.fn().mockResolvedValue(true),
}));
vi.mock('../_helpers/workspaceAgentGuard', () => ({
  getWorkspaceAgentParentGroupIds: vi.fn().mockResolvedValue([]),
  getWorkspaceGroupVirtualAgentIds: vi.fn().mockResolvedValue([]),
}));
vi.mock('../_helpers/platformAdminGuard', () => ({
  hasActivePlatformAdminAccess: vi.fn().mockResolvedValue(true),
  requirePlatformAdmin: vi.fn((opts: any) => opts.next()),
}));

// The recipient check reads workspace membership from the DB; `mockCtx.serverDB`
// is a bare object, so stub the whole check and assert on its inputs instead.
vi.mock('@/server/services/resourceTransferRequest', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, assertTransferRecipientValid: vi.fn() };
});

vi.mock('@/server/services/resourcePermission', () => ({
  assertCanEditResource: vi.fn(),
  assertCanPerformResourceAction: vi.fn(),
  buildResourcePermissionState: vi.fn((params: any) => ({
    ...params,
    generalAccess: params.accessLevel === 'edit' ? 'editor' : 'viewer',
  })),
  canPerformResourceAction: vi.fn(),
  getResourceMeta: vi.fn(),
  // `resourceConfigGuard` classifies collaborative builtins to exempt them from the
  // parent-group cap; without this export the guard throws before any assertion.
  isCollaborativeBuiltinAgent: vi.fn(() => false),
}));

const publishResourceEventMock = vi.mocked(publishResourceEvent);

describe('agentGroupRouter', () => {
  const userId = 'testUserId';
  let mockCtx: any;
  let agentModelMock: any;
  let chatGroupModelMock: any;
  let agentGroupRepoMock: any;
  let userModelMock: any;
  let chatGroupServiceMock: any;
  let resourcePermissionModelMock: any;
  let transferRequestModelMock: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    profileBackfill.mockReset().mockResolvedValue(false);
    defaultTravelServiceMutationGuard.mockReset().mockResolvedValue(undefined);
    reservedTravelServiceIdentityGuard.mockReset();
    vi.mocked(hasActivePlatformAdminAccess).mockResolvedValue(true);
    vi.mocked(getWorkspaceAgentParentGroupIds).mockResolvedValue([]);
    vi.mocked(getWorkspaceGroupVirtualAgentIds).mockResolvedValue([]);
    vi.mocked(hasWorkspaceScopedPermission).mockResolvedValue(true);
    vi.mocked(isWorkspacePrimaryOwner).mockResolvedValue(true);

    agentModelMock = {
      batchCreate: vi.fn(),
    };

    chatGroupModelMock = {
      addAgentsToGroup: vi.fn(),
      create: vi.fn(),
      createWithAgents: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(),
      getGroupAgents: vi.fn(),
      publishToWorkspace: vi.fn(),
      queryWithMemberDetails: vi.fn(),
      removeAgentFromGroup: vi.fn(),
      setVisibility: vi.fn(),
      update: vi.fn(),
      updateAgentInGroup: vi.fn(),
    };

    agentGroupRepoMock = {
      createGroupWithSupervisor: vi.fn(),
      duplicate: vi.fn(),
      findByIdWithAgents: vi.fn(),
      removeAgentsFromGroup: vi.fn(),
      transferHasForeignRows: vi.fn().mockResolvedValue(false),
      transferToWorkspace: vi.fn(),
    };

    userModelMock = {
      getUserSettingsDefaultAgentConfig: vi.fn().mockResolvedValue({}),
    };

    chatGroupServiceMock = {
      deleteGroup: vi.fn(),
      getGroupDetail: vi.fn(),
      getGroups: vi.fn(),
      mergeAgentsDefaultConfig: vi.fn((_, agents) => agents),
      normalizeGroupConfig: vi.fn((config) =>
        config ? { ...DEFAULT_CHAT_GROUP_CHAT_CONFIG, ...config } : undefined,
      ),
    };

    resourcePermissionModelMock = {
      getAccessLevel: vi.fn().mockResolvedValue(null),
      removeAll: vi.fn(),
      setAccessLevel: vi.fn(),
    };

    transferRequestModelMock = {
      create: vi.fn(),
      invalidateForResources: vi.fn(),
    };

    // Use vi.spyOn to mock the class constructors to return our mock instances
    vi.spyOn(AgentModelModule, 'AgentModel').mockImplementation(() => agentModelMock as any);
    vi.spyOn(ResourcePermissionModelModule, 'ResourcePermissionModel').mockImplementation(
      () => resourcePermissionModelMock as any,
    );
    vi.spyOn(ChatGroupModelModule, 'ChatGroupModel').mockImplementation(
      () => chatGroupModelMock as any,
    );
    vi.spyOn(AgentGroupRepoModule, 'AgentGroupRepository').mockImplementation(
      () => agentGroupRepoMock as any,
    );
    vi.spyOn(UserModelModule, 'UserModel').mockImplementation(() => userModelMock as any);
    vi.spyOn(ResourceTransferRequestModelModule, 'ResourceTransferRequestModel').mockImplementation(
      () => transferRequestModelMock as any,
    );
    vi.spyOn(ChatGroupServiceModule, 'AgentGroupService').mockImplementation(
      () => chatGroupServiceMock as any,
    );

    mockCtx = {
      serverDB: {},
      userId,
    };
  });

  describe('createGroup', () => {
    it('should create a group with normalized config', async () => {
      const mockInput = {
        title: 'Test Group',
        description: 'Test Description',
        config: {
          allowDM: true,
        },
      };

      const mockCreatedGroup = {
        id: 'group-1',
        title: 'Test Group',
        description: 'Test Description',
        config: { ...DEFAULT_CHAT_GROUP_CHAT_CONFIG, allowDM: true },
      };

      agentGroupRepoMock.createGroupWithSupervisor.mockResolvedValue({
        group: mockCreatedGroup,
        supervisorAgentId: 'supervisor-1',
      });

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.createGroup(mockInput);

      expect(agentGroupRepoMock.createGroupWithSupervisor).toHaveBeenCalledWith({
        ...mockInput,
        config: { ...DEFAULT_CHAT_GROUP_CHAT_CONFIG, allowDM: true },
      });
      expect(result).toEqual({ group: mockCreatedGroup, supervisorAgentId: 'supervisor-1' });
    });

    it('should create a group without config', async () => {
      const mockInput = {
        title: 'Test Group',
      };

      const mockCreatedGroup = {
        id: 'group-1',
        title: 'Test Group',
      };

      agentGroupRepoMock.createGroupWithSupervisor.mockResolvedValue({
        group: mockCreatedGroup,
        supervisorAgentId: 'supervisor-1',
      });

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.createGroup(mockInput);

      expect(agentGroupRepoMock.createGroupWithSupervisor).toHaveBeenCalledWith({
        ...mockInput,
        config: undefined,
      });
      expect(result).toEqual({ group: mockCreatedGroup, supervisorAgentId: 'supervisor-1' });
    });
  });

  describe('createGroupWithMembers', () => {
    it('should create a group with virtual member agents', async () => {
      const mockInput = {
        groupConfig: {
          title: 'Team Group',
          config: { allowDM: true },
        },
        members: [
          { title: 'Agent 1', systemRole: 'Helper' },
          { title: 'Agent 2', systemRole: 'Assistant' },
        ],
      };

      const mockCreatedAgents = [{ id: 'agent-1' }, { id: 'agent-2' }];
      const mockCreatedGroup = { id: 'group-1', title: 'Team Group' };

      agentModelMock.batchCreate.mockResolvedValue(mockCreatedAgents);
      agentGroupRepoMock.createGroupWithSupervisor.mockResolvedValue({
        group: mockCreatedGroup,
        supervisorAgentId: 'supervisor-1',
      });

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.createGroupWithMembers(mockInput);

      expect(agentModelMock.batchCreate).toHaveBeenCalledWith([
        { title: 'Agent 1', systemRole: 'Helper', virtual: true },
        { title: 'Agent 2', systemRole: 'Assistant', virtual: true },
      ]);
      expect(agentGroupRepoMock.createGroupWithSupervisor).toHaveBeenCalledWith(
        {
          title: 'Team Group',
          config: { ...DEFAULT_CHAT_GROUP_CHAT_CONFIG, allowDM: true },
        },
        ['agent-1', 'agent-2'],
        undefined,
      );
      expect(result).toEqual({
        agentIds: ['agent-1', 'agent-2'],
        groupId: 'group-1',
        supervisorAgentId: 'supervisor-1',
      });
    });
  });

  describe('deleteGroup', () => {
    it('should delete a group by id', async () => {
      chatGroupModelMock.findById.mockResolvedValue({ id: 'group-1', userId });
      chatGroupServiceMock.deleteGroup.mockResolvedValue({
        deletedVirtualAgentIds: [],
        group: { id: 'group-1' },
      });

      const caller = agentGroupRouter.createCaller(mockCtx);
      await caller.deleteGroup({ id: 'group-1' });

      expect(chatGroupServiceMock.deleteGroup).toHaveBeenCalledWith('group-1');
    });
  });

  describe('transferGroup to a workspace member', () => {
    const wsCtx = () => ({ serverDB: {}, userId, workspaceId: 'ws-1' });

    it('creates a pending request instead of moving the group', async () => {
      chatGroupModelMock.findById.mockResolvedValue({ id: 'cg_1', userId: 'creator-1' });
      transferRequestModelMock.create.mockResolvedValue({ id: 'req-9' });

      const result = await agentGroupRouter.createCaller(wsCtx() as any).transferGroup({
        groupId: 'cg_1',
        targetMemberId: 'member-2',
        targetWorkspaceId: null,
      });

      expect(result).toEqual({ requestId: 'req-9', status: 'pending' });
      expect(transferRequestModelMock.create).toHaveBeenCalledWith({
        initiatorId: userId,
        previousOwnerId: 'creator-1',
        recipientId: 'member-2',
        resourceId: 'cg_1',
        resourceType: 'agentGroup',
      });
      // The pending handshake moves nothing yet.
      expect(agentGroupRepoMock.transferToWorkspace).not.toHaveBeenCalled();
    });

    it('rejects an empty targetMemberId instead of falling through to scope transfer', async () => {
      chatGroupModelMock.findById.mockResolvedValue({ id: 'cg_1', userId });

      await expect(
        agentGroupRouter.createCaller(wsCtx() as any).transferGroup({
          groupId: 'cg_1',
          targetMemberId: '',
          targetWorkspaceId: null,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      // Schema-level rejection: neither the pending-request path nor the
      // legacy scope-transfer path may run.
      expect(transferRequestModelMock.create).not.toHaveBeenCalled();
      expect(agentGroupRepoMock.transferToWorkspace).not.toHaveBeenCalled();
    });

    it('rejects member transfer outside a workspace', async () => {
      chatGroupModelMock.findById.mockResolvedValue({ id: 'cg_1', userId });

      await expect(
        agentGroupRouter.createCaller(mockCtx).transferGroup({
          groupId: 'cg_1',
          targetMemberId: 'member-2',
          targetWorkspaceId: null,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('maps an existing pending request to CONFLICT', async () => {
      chatGroupModelMock.findById.mockResolvedValue({ id: 'cg_1', userId });
      transferRequestModelMock.create.mockRejectedValue(
        new Error(TRANSFER_REQUEST_ALREADY_PENDING),
      );

      await expect(
        agentGroupRouter.createCaller(wsCtx() as any).transferGroup({
          groupId: 'cg_1',
          targetMemberId: 'member-2',
          targetWorkspaceId: null,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('getGroup', () => {
    it('should get a group by id', async () => {
      const mockGroup = {
        id: 'group-1',
        title: 'Test Group',
        config: DEFAULT_CHAT_GROUP_CHAT_CONFIG,
      };

      chatGroupModelMock.findById.mockResolvedValue(mockGroup);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.getGroup({ id: 'group-1' });

      expect(chatGroupModelMock.findById).toHaveBeenCalledWith('group-1');
      expect(result).toEqual(mockGroup);
    });

    it('should return undefined if group not found', async () => {
      chatGroupModelMock.findById.mockResolvedValue(undefined);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.getGroup({ id: 'non-existent' });

      expect(result).toBeUndefined();
    });
  });

  describe('getGroupDetail', () => {
    it('backfills a regular owner while keeping administrator configuration redacted', async () => {
      vi.mocked(hasActivePlatformAdminAccess).mockResolvedValue(false);
      const detail = {
        id: 'group-1',
        clientId: 'default-travel-service-group',
        userId,
        workspaceId: null,
        visibility: 'private',
        content: 'private group duties',
        agents: [
          {
            id: 'host',
            title: '旅游群主AI',
            description: null as string | null,
            systemRole: 'private agent prompt',
            userId,
            workspaceId: null,
          },
        ],
      };
      chatGroupServiceMock.getGroupDetail.mockImplementation(async () => structuredClone(detail));
      profileBackfill.mockImplementationOnce(async () => {
        detail.agents[0].description = 'Coordinates the work group';
        return true;
      });

      const result = await agentGroupRouter.createCaller(mockCtx).getGroupDetail({ id: 'group-1' });
      expect(result?.agents[0].description).toBe('Coordinates the work group');
      expect(result).not.toHaveProperty('content');
      expect(result?.agents[0]).not.toHaveProperty('systemRole');
      expect(chatGroupServiceMock.mergeAgentsDefaultConfig).not.toHaveBeenCalled();
    });

    it('returns the backfilled supervisor introduction on the first direct owner visit', async () => {
      const detail = {
        id: 'group-1',
        clientId: 'default-travel-service-group',
        userId,
        workspaceId: null,
        visibility: 'private',
        agents: [{ id: 'host', title: '旅游群主AI', description: null, userId, workspaceId: null }],
      };
      chatGroupServiceMock.getGroupDetail.mockImplementation(async () => structuredClone(detail));
      profileBackfill.mockImplementationOnce(async () => {
        detail.agents[0].description = 'Coordinates the work group' as any;
        return true;
      });

      const result = await agentGroupRouter.createCaller(mockCtx).getGroupDetail({ id: 'group-1' });
      expect(result?.agents[0].description).toBe('Coordinates the work group');
    });

    it('should get group detail with agents', async () => {
      const mockGroupDetail = {
        id: 'group-1',
        title: 'Test Group',
        config: DEFAULT_CHAT_GROUP_CHAT_CONFIG,
        agents: [
          { id: 'agent-1', title: 'Agent 1', userId, workspaceId: null },
          { id: 'agent-2', title: 'Agent 2', userId, workspaceId: null },
        ],
      };

      chatGroupServiceMock.getGroupDetail.mockResolvedValue(mockGroupDetail);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.getGroupDetail({ id: 'group-1' });

      expect(chatGroupServiceMock.getGroupDetail).toHaveBeenCalledWith('group-1');
      expect(result).toEqual(mockGroupDetail);
    });

    it('should return null if group not found', async () => {
      chatGroupServiceMock.getGroupDetail.mockResolvedValue(null);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.getGroupDetail({ id: 'non-existent' });

      expect(result).toBeNull();
    });

    it('redacts group and member configuration for a member without edit access', async () => {
      const fullGroupDetail = {
        agents: [
          {
            id: 'agent-1',
            isSupervisor: true,
            model: 'private-model',
            plugins: ['private-tool'],
            systemRole: 'private member prompt',
            title: 'Agent 1',
          },
        ],
        config: { openingMessage: 'Welcome', systemPrompt: 'private group prompt' },
        content: 'private editor content',
        id: 'group-1',
        supervisorAgentId: 'agent-1',
        title: 'Test Group',
        userId: 'creator-1',
        visibility: 'public',
        workspaceId: 'ws-1',
      };
      chatGroupServiceMock.getGroupDetail.mockResolvedValue(fullGroupDetail);
      vi.mocked(canPerformResourceAction).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const caller = agentGroupRouter.createCaller({ ...mockCtx, workspaceId: 'ws-1' });
      const result = await caller.getGroupDetail({ id: 'group-1' });

      expect(result).toEqual({
        agents: [{ id: 'agent-1', isSupervisor: true, title: 'Agent 1' }],
        config: { openingMessage: 'Welcome' },
        id: 'group-1',
        supervisorAgentId: 'agent-1',
        title: 'Test Group',
        userId: 'creator-1',
        visibility: 'public',
        workspaceId: 'ws-1',
      });
      expect(userModelMock.getUserSettingsDefaultAgentConfig).not.toHaveBeenCalled();
    });

    it('keeps editable group config but redacts separately restricted member agents', async () => {
      const fullGroupDetail = {
        agents: [
          {
            id: 'agent-1',
            model: 'private-model',
            systemRole: 'private member prompt',
            title: 'Agent 1',
            userId: 'creator-1',
            visibility: 'public',
            workspaceId: 'ws-1',
          },
        ],
        config: { systemPrompt: 'editable group prompt' },
        id: 'group-1',
        title: 'Test Group',
        userId: 'creator-1',
        visibility: 'public',
        workspaceId: 'ws-1',
      };
      chatGroupServiceMock.getGroupDetail.mockResolvedValue(fullGroupDetail);
      vi.mocked(canPerformResourceAction)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const caller = agentGroupRouter.createCaller({ ...mockCtx, workspaceId: 'ws-1' });
      const result = await caller.getGroupDetail({ id: 'group-1' });

      expect(result).toEqual({
        ...fullGroupDetail,
        agents: [
          {
            id: 'agent-1',
            title: 'Agent 1',
            userId: 'creator-1',
            visibility: 'public',
            workspaceId: 'ws-1',
          },
        ],
      });
      expect(result?.config).toEqual({ systemPrompt: 'editable group prompt' });
      expect(result?.agents[0]).not.toHaveProperty('systemRole');
    });
  });

  describe('getGroupAgents', () => {
    it('should get agents of a group', async () => {
      const mockAgents = [
        { agentId: 'agent-1', chatGroupId: 'group-1', order: 0 },
        { agentId: 'agent-2', chatGroupId: 'group-1', order: 1 },
      ];

      chatGroupModelMock.getGroupAgents.mockResolvedValue(mockAgents);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.getGroupAgents({ groupId: 'group-1' });

      expect(chatGroupModelMock.getGroupAgents).toHaveBeenCalledWith('group-1');
      expect(result).toEqual(mockAgents);
    });
  });

  describe('getGroups', () => {
    it('should get all groups with member details', async () => {
      const mockGroups = [
        { id: 'group-1', title: 'Group 1', agents: [] },
        { id: 'group-2', title: 'Group 2', agents: [] },
      ];

      chatGroupServiceMock.getGroups.mockResolvedValue(mockGroups);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.getGroups();

      expect(chatGroupServiceMock.getGroups).toHaveBeenCalled();
      expect(result).toEqual(mockGroups);
    });

    it('redacts config-bearing list results for use/view-only members', async () => {
      const groups = [
        {
          agents: [{ id: 'agent-1', systemRole: 'private prompt', title: 'Agent 1' }],
          config: { systemPrompt: 'private group prompt' },
          id: 'group-1',
          title: 'Group 1',
          userId: 'creator-1',
          visibility: 'public',
          workspaceId: 'ws-1',
        },
      ];
      chatGroupServiceMock.getGroups.mockResolvedValue(groups);
      vi.mocked(canPerformResourceAction).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const caller = agentGroupRouter.createCaller({ ...mockCtx, workspaceId: 'ws-1' });
      const result = await caller.getGroups();

      expect(result).toEqual([
        {
          agents: [{ id: 'agent-1', title: 'Agent 1' }],
          config: {},
          id: 'group-1',
          title: 'Group 1',
          userId: 'creator-1',
          visibility: 'public',
          workspaceId: 'ws-1',
        },
      ]);
      expect(userModelMock.getUserSettingsDefaultAgentConfig).not.toHaveBeenCalled();
    });
  });

  describe('addAgentsToGroup', () => {
    it('should add agents to a group', async () => {
      const mockInput = {
        groupId: 'group-1',
        agentIds: ['agent-1', 'agent-2'],
      };

      const mockResult = [
        { agentId: 'agent-1', chatGroupId: 'group-1' },
        { agentId: 'agent-2', chatGroupId: 'group-1' },
      ];

      chatGroupModelMock.addAgentsToGroup.mockResolvedValue(mockResult);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.addAgentsToGroup(mockInput);

      expect(chatGroupModelMock.addAgentsToGroup).toHaveBeenCalledWith('group-1', [
        'agent-1',
        'agent-2',
      ]);
      expect(result).toEqual(mockResult);
    });
  });

  describe('removeAgentsFromGroup', () => {
    it('should remove agents from a group', async () => {
      const mockInput = {
        groupId: 'group-1',
        agentIds: ['agent-1', 'agent-2'],
      };

      const mockResult = {
        deletedVirtualAgentIds: [],
        removedFromGroup: 2,
      };

      chatGroupModelMock.findById.mockResolvedValue({ id: 'group-1', userId });
      agentGroupRepoMock.removeAgentsFromGroup.mockResolvedValue(mockResult);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.removeAgentsFromGroup(mockInput);

      expect(agentGroupRepoMock.removeAgentsFromGroup).toHaveBeenCalledWith(
        'group-1',
        ['agent-1', 'agent-2'],
        undefined,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('updateAgentInGroup', () => {
    it('should update agent in a group', async () => {
      const mockInput = {
        groupId: 'group-1',
        agentId: 'agent-1',
        updates: { order: 2, role: 'participant' as const },
      };

      const mockResult = {
        agentId: 'agent-1',
        chatGroupId: 'group-1',
        order: 2,
        role: 'participant',
      };

      chatGroupModelMock.updateAgentInGroup.mockResolvedValue(mockResult);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.updateAgentInGroup(mockInput);

      expect(chatGroupModelMock.updateAgentInGroup).toHaveBeenCalledWith('group-1', 'agent-1', {
        order: 2,
        role: 'participant',
      });
      expect(result).toEqual(mockResult);
    });

    it('should reject a role outside the known set', async () => {
      // `role` used to be `z.string()`, so a typo reached the DB and then read
      // back everywhere as "not a supervisor" — including in the delete and
      // transfer paths that key their lifecycle decisions on it.
      const caller = agentGroupRouter.createCaller(mockCtx);

      await expect(
        caller.updateAgentInGroup({
          agentId: 'agent-1',
          groupId: 'group-1',
          updates: { role: 'leader' as never },
        }),
      ).rejects.toThrow();
      expect(chatGroupModelMock.updateAgentInGroup).not.toHaveBeenCalled();
    });

    it('should update agent with enabled flag', async () => {
      const mockInput = {
        groupId: 'group-1',
        agentId: 'agent-1',
        updates: { enabled: false },
      };

      chatGroupModelMock.updateAgentInGroup.mockResolvedValue({});

      const caller = agentGroupRouter.createCaller(mockCtx);
      await caller.updateAgentInGroup(mockInput);

      expect(chatGroupModelMock.updateAgentInGroup).toHaveBeenCalledWith('group-1', 'agent-1', {
        enabled: false,
      });
    });
  });

  describe('updateGroup', () => {
    it('should treat null config as no config change', async () => {
      const caller = agentGroupRouter.createCaller(mockCtx);
      await caller.updateGroup({ id: 'group-1', value: { config: null, title: 'Keep config' } });
      expect(chatGroupModelMock.update).toHaveBeenCalledWith('group-1', {
        config: undefined,
        title: 'Keep config',
      });
    });

    it('should request an atomic config patch with defaults', async () => {
      const mockInput = {
        id: 'group-1',
        value: {
          title: 'Updated Title',
          config: { allowDM: false },
        },
      };

      const mockUpdatedGroup = {
        id: 'group-1',
        title: 'Updated Title',
        config: { ...DEFAULT_CHAT_GROUP_CHAT_CONFIG, allowDM: false },
      };

      chatGroupModelMock.update.mockResolvedValue(mockUpdatedGroup);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.updateGroup(mockInput);

      expect(chatGroupModelMock.update).toHaveBeenCalledWith(
        'group-1',
        { title: 'Updated Title', config: { allowDM: false } },
        { configDefaults: DEFAULT_CHAT_GROUP_CHAT_CONFIG },
      );
      expect(result).toEqual(mockUpdatedGroup);
    });

    it('should strip server-managed config fields before applying the patch', async () => {
      const caller = agentGroupRouter.createCaller(mockCtx);
      const config = {
        maxDiscussionRounds: 3,
        memberSlots: [{ agentId: 'forged-agent' }],
        superGroupTemplate: { identifier: 'forged-template' },
      };
      await caller.updateGroup({ id: 'group-1', value: { config } });
      expect(chatGroupModelMock.update).toHaveBeenCalledWith(
        'group-1',
        { config: { maxDiscussionRounds: 3 } },
        { configDefaults: DEFAULT_CHAT_GROUP_CHAT_CONFIG },
      );
    });

    it('should update a group without config changes', async () => {
      const mockInput = {
        id: 'group-1',
        value: {
          title: 'New Title',
          description: 'New Description',
        },
      };

      const mockUpdatedGroup = {
        id: 'group-1',
        title: 'New Title',
        description: 'New Description',
      };

      chatGroupModelMock.update.mockResolvedValue(mockUpdatedGroup);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.updateGroup(mockInput);

      expect(chatGroupModelMock.update).toHaveBeenCalledWith('group-1', {
        title: 'New Title',
        description: 'New Description',
        config: undefined,
      });
      expect(result).toEqual(mockUpdatedGroup);
    });
  });

  describe('platform-managed default travel group write guard', () => {
    const managedGroupError = () =>
      new TRPCError({
        code: 'FORBIDDEN',
        message: 'This platform-managed travel resource cannot be changed',
      });

    const writeCases: Array<
      [string, (caller: ReturnType<typeof agentGroupRouter.createCaller>) => Promise<unknown>]
    > = [
      [
        'adding existing members',
        (caller) => caller.addAgentsToGroup({ agentIds: ['agent-1'], groupId: 'managed-group' }),
      ],
      [
        'batch-creating virtual members',
        (caller) =>
          caller.batchCreateAgentsInGroup({
            agents: [{ title: 'New virtual member' }],
            groupId: 'managed-group',
          }),
      ],
      [
        'removing a member without deleting its agent',
        (caller) =>
          caller.removeAgentsFromGroup({
            agentIds: ['agent-1'],
            deleteVirtualAgents: false,
            groupId: 'managed-group',
          }),
      ],
      [
        'removing and deleting a virtual member',
        (caller) =>
          caller.removeAgentsFromGroup({
            agentIds: ['agent-1'],
            deleteVirtualAgents: true,
            groupId: 'managed-group',
          }),
      ],
      [
        'disabling a member',
        (caller) =>
          caller.updateAgentInGroup({
            agentId: 'agent-1',
            groupId: 'managed-group',
            updates: { enabled: false },
          }),
      ],
      [
        'reordering a member',
        (caller) =>
          caller.updateAgentInGroup({
            agentId: 'agent-1',
            groupId: 'managed-group',
            updates: { order: 2 },
          }),
      ],
      [
        'changing a member role',
        (caller) =>
          caller.updateAgentInGroup({
            agentId: 'agent-1',
            groupId: 'managed-group',
            updates: { role: 'participant' },
          }),
      ],
      [
        'deleting the group and its virtual members',
        (caller) => caller.deleteGroup({ id: 'managed-group' }),
      ],
      [
        'updating group configuration',
        (caller) =>
          caller.updateGroup({
            id: 'managed-group',
            value: { config: { systemPrompt: 'replacement prompt' } },
          }),
      ],
      [
        'updating group content',
        (caller) =>
          caller.updateGroup({ id: 'managed-group', value: { content: 'replacement content' } }),
      ],
    ];

    it.each(writeCases)('rejects %s before a model write', async (_name, mutate) => {
      defaultTravelServiceMutationGuard.mockRejectedValueOnce(managedGroupError());

      await expect(mutate(agentGroupRouter.createCaller(mockCtx))).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'This platform-managed travel resource cannot be changed',
      });

      expect(agentModelMock.batchCreate).not.toHaveBeenCalled();
      expect(chatGroupModelMock.addAgentsToGroup).not.toHaveBeenCalled();
      expect(chatGroupModelMock.updateAgentInGroup).not.toHaveBeenCalled();
      expect(chatGroupModelMock.update).not.toHaveBeenCalled();
      expect(agentGroupRepoMock.removeAgentsFromGroup).not.toHaveBeenCalled();
      expect(chatGroupServiceMock.deleteGroup).not.toHaveBeenCalled();
    });

    const guardedGroupCases: Array<
      [string, (caller: ReturnType<typeof agentGroupRouter.createCaller>) => Promise<unknown>]
    > = [
      ['duplicating it', (caller) => caller.duplicateGroup({ groupId: 'managed-group' })],
      [
        'transferring it',
        (caller) =>
          caller.transferGroup({
            groupId: 'managed-group',
            targetWorkspaceId: 'target-workspace',
          }),
      ],
      ['publishing it', (caller) => caller.publishGroupToWorkspace({ id: 'managed-group' })],
      [
        'changing its visibility',
        (caller) => caller.setGroupVisibility({ id: 'managed-group', visibility: 'public' }),
      ],
    ];

    it.each(guardedGroupCases)(
      'rejects %s before reading or writing the target',
      async (_name, mutate) => {
        defaultTravelServiceMutationGuard.mockRejectedValueOnce(managedGroupError());

        await expect(mutate(agentGroupRouter.createCaller(mockCtx))).rejects.toMatchObject({
          code: 'FORBIDDEN',
          message: 'This platform-managed travel resource cannot be changed',
        });

        expect(agentGroupRepoMock.duplicate).not.toHaveBeenCalled();
        expect(agentGroupRepoMock.transferToWorkspace).not.toHaveBeenCalled();
        expect(chatGroupModelMock.publishToWorkspace).not.toHaveBeenCalled();
        expect(chatGroupModelMock.setVisibility).not.toHaveBeenCalled();
      },
    );

    it('rejects a reserved group identity before creating a group', async () => {
      reservedTravelServiceIdentityGuard.mockImplementationOnce(() => {
        throw managedGroupError();
      });

      await expect(
        agentGroupRouter.createCaller(mockCtx).createGroup({
          clientId: 'default-travel-service-group',
          title: 'Forged default group',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(agentGroupRepoMock.createGroupWithSupervisor).not.toHaveBeenCalled();
    });

    it('rejects a reserved member identity before batch creating agents', async () => {
      reservedTravelServiceIdentityGuard
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw managedGroupError();
        });

      await expect(
        agentGroupRouter.createCaller(mockCtx).createGroupWithMembers({
          groupConfig: { title: 'Regular group' },
          members: [{ clientId: 'default-travel-copywriter', title: 'Forged member' }],
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(agentModelMock.batchCreate).not.toHaveBeenCalled();
      expect(agentGroupRepoMock.createGroupWithSupervisor).not.toHaveBeenCalled();
    });
  });

  // The Permission page lets a creator pick an access level while the group is
  // still private ("Members get this level once the group is published"). Both
  // routes into the publish transition must read that row back — stamping the
  // default over it silently upgrades everyone to `edit`.
  describe('publish keeps the level chosen while private', () => {
    beforeEach(() => {
      mockCtx.workspaceId = 'ws_1';
      chatGroupModelMock.countPrivateGroupAgents = vi.fn().mockResolvedValue(0);
      chatGroupModelMock.publishToWorkspace = vi.fn().mockResolvedValue({ success: true });
      chatGroupModelMock.setVisibility = vi.fn().mockResolvedValue(true);
      chatGroupModelMock.findById.mockResolvedValue({
        id: 'cg_1',
        userId,
        visibility: 'private',
        workspaceId: 'ws_1',
      });
    });

    it('publishGroupToWorkspace reads the stored level', async () => {
      resourcePermissionModelMock.getAccessLevel.mockResolvedValue('use');

      await agentGroupRouter.createCaller(mockCtx).publishGroupToWorkspace({ id: 'cg_1' });

      expect(resourcePermissionModelMock.setAccessLevel).toHaveBeenCalledWith(
        'agentGroup',
        'cg_1',
        'use',
        userId,
      );
    });

    it('publishGroupToWorkspace falls back to the default when nothing was stored', async () => {
      await agentGroupRouter.createCaller(mockCtx).publishGroupToWorkspace({ id: 'cg_1' });

      expect(resourcePermissionModelMock.setAccessLevel).toHaveBeenCalledWith(
        'agentGroup',
        'cg_1',
        'edit',
        userId,
      );
    });

    it('publishGroupToWorkspace lets an explicit request win', async () => {
      resourcePermissionModelMock.getAccessLevel.mockResolvedValue('use');

      await agentGroupRouter
        .createCaller(mockCtx)
        .publishGroupToWorkspace({ accessLevel: 'view', id: 'cg_1' });

      expect(resourcePermissionModelMock.setAccessLevel).toHaveBeenCalledWith(
        'agentGroup',
        'cg_1',
        'view',
        userId,
      );
    });

    it('setGroupVisibility reads the stored level when promoting', async () => {
      resourcePermissionModelMock.getAccessLevel.mockResolvedValue('use');

      await agentGroupRouter
        .createCaller(mockCtx)
        .setGroupVisibility({ id: 'cg_1', visibility: 'public' });

      expect(resourcePermissionModelMock.setAccessLevel).toHaveBeenCalledWith(
        'agentGroup',
        'cg_1',
        'use',
        userId,
      );
    });

    // `assertCanEditResource` authorizes an agent by its own ACL alone, so a
    // virtual agent left without a row falls back to the agent default (`edit`)
    // and stays editable by everyone despite a use-only group.
    describe('cascades the level to group-owned virtual agents', () => {
      beforeEach(() => {
        vi.mocked(getWorkspaceGroupVirtualAgentIds).mockResolvedValue(['agt_sup', 'agt_member']);
        resourcePermissionModelMock.getAccessLevel.mockResolvedValue('use');
      });

      it('on publishGroupToWorkspace', async () => {
        await agentGroupRouter.createCaller(mockCtx).publishGroupToWorkspace({ id: 'cg_1' });

        expect(resourcePermissionModelMock.setAccessLevel).toHaveBeenCalledWith(
          'agent',
          'agt_sup',
          'use',
          userId,
        );
        expect(resourcePermissionModelMock.setAccessLevel).toHaveBeenCalledWith(
          'agent',
          'agt_member',
          'use',
          userId,
        );
      });

      it('on transferGroup into the target workspace', async () => {
        agentGroupRepoMock.transferToWorkspace = vi.fn().mockResolvedValue({ success: true });

        await agentGroupRouter.createCaller(mockCtx).transferGroup({
          groupId: 'cg_1',
          targetAccessLevel: 'use',
          targetVisibility: 'public',
          targetWorkspaceId: 'ws_2',
        });

        expect(resourcePermissionModelMock.setAccessLevel).toHaveBeenCalledWith(
          'agent',
          'agt_sup',
          'use',
          userId,
        );
        expect(resourcePermissionModelMock.setAccessLevel).toHaveBeenCalledWith(
          'agent',
          'agt_member',
          'use',
          userId,
        );
      });

      it('on setGroupVisibility promotion', async () => {
        await agentGroupRouter
          .createCaller(mockCtx)
          .setGroupVisibility({ id: 'cg_1', visibility: 'public' });

        expect(resourcePermissionModelMock.setAccessLevel).toHaveBeenCalledWith(
          'agent',
          'agt_sup',
          'use',
          userId,
        );
        expect(resourcePermissionModelMock.setAccessLevel).toHaveBeenCalledWith(
          'agent',
          'agt_member',
          'use',
          userId,
        );
      });
    });
  });

  describe('edit lock', () => {
    const wsCtx = () => ({ serverDB: {}, userId, workspaceId: 'ws-1' });

    describe('updateGroup write guard', () => {
      it('rejects the update when another member holds the lock', async () => {
        vi.spyOn(EditLockService.prototype, 'getBlockingHolder').mockResolvedValue('other-user');

        const caller = agentGroupRouter.createCaller(wsCtx());

        await expect(
          caller.updateGroup({ id: 'group-1', value: { title: 'New' } }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(chatGroupModelMock.update).not.toHaveBeenCalled();
      });

      it('allows the update when no other member holds the lock', async () => {
        vi.spyOn(EditLockService.prototype, 'getBlockingHolder').mockResolvedValue(null);
        chatGroupModelMock.update.mockResolvedValue({ id: 'group-1' });

        const caller = agentGroupRouter.createCaller(wsCtx());
        await caller.updateGroup({ id: 'group-1', value: { title: 'New' } });

        expect(chatGroupModelMock.update).toHaveBeenCalled();
      });

      it('does not check the lock for personal (non-workspace) groups', async () => {
        const guardSpy = vi.spyOn(EditLockService.prototype, 'getBlockingHolder');
        chatGroupModelMock.update.mockResolvedValue({ id: 'group-1' });

        const caller = agentGroupRouter.createCaller(mockCtx);
        await caller.updateGroup({ id: 'group-1', value: { title: 'New' } });

        expect(guardSpy).not.toHaveBeenCalled();
        expect(chatGroupModelMock.update).toHaveBeenCalled();
      });
    });

    describe('acquireGroupLock', () => {
      it('returns unlocked without touching the lock service for personal groups', async () => {
        const acquireSpy = vi.spyOn(EditLockService.prototype, 'acquire');

        const caller = agentGroupRouter.createCaller(mockCtx);
        const result = await caller.acquireGroupLock({ id: 'group-1' });

        expect(result).toEqual({ expiresAt: null, holderId: null, lockedByOther: false });
        expect(acquireSpy).not.toHaveBeenCalled();
      });

      it('broadcasts lock.changed on a holder edge (first claim)', async () => {
        vi.spyOn(EditLockService.prototype, 'getActiveHolder').mockResolvedValue(undefined);
        vi.spyOn(EditLockService.prototype, 'acquire').mockResolvedValue({
          expiresAt: new Date(),
          holderId: userId,
          lockedByOther: false,
          ownerId: null,
        });

        const caller = agentGroupRouter.createCaller(wsCtx());
        await caller.acquireGroupLock({ id: 'group-1' });

        expect(publishResourceEventMock).toHaveBeenCalledWith(
          { id: 'group-1', type: 'chatGroup' },
          expect.objectContaining({ data: { holderId: userId }, type: 'lock.changed' }),
        );
      });

      it('does NOT broadcast on a steady-state heartbeat (same holder)', async () => {
        vi.spyOn(EditLockService.prototype, 'getActiveHolder').mockResolvedValue(userId);
        vi.spyOn(EditLockService.prototype, 'acquire').mockResolvedValue({
          expiresAt: new Date(),
          holderId: userId,
          lockedByOther: false,
          ownerId: null,
        });

        const caller = agentGroupRouter.createCaller(wsCtx());
        await caller.acquireGroupLock({ id: 'group-1' });

        expect(publishResourceEventMock).not.toHaveBeenCalled();
      });
    });

    describe('getGroupLock', () => {
      it('reports another member as the holder', async () => {
        vi.spyOn(EditLockService.prototype, 'getActiveHolder').mockResolvedValue('other-user');

        const caller = agentGroupRouter.createCaller(wsCtx());
        const result = await caller.getGroupLock({ id: 'group-1' });

        expect(result).toEqual({ expiresAt: null, holderId: 'other-user', lockedByOther: true });
      });

      it('returns unlocked for personal groups', async () => {
        const caller = agentGroupRouter.createCaller(mockCtx);
        const result = await caller.getGroupLock({ id: 'group-1' });

        expect(result).toEqual({ expiresAt: null, holderId: null, lockedByOther: false });
      });
    });

    describe('releaseGroupLock', () => {
      it('broadcasts unlocked only when it actually freed the lock', async () => {
        vi.spyOn(EditLockService.prototype, 'release').mockResolvedValue(true);

        const caller = agentGroupRouter.createCaller(wsCtx());
        await caller.releaseGroupLock({ id: 'group-1' });

        expect(publishResourceEventMock).toHaveBeenCalledWith(
          { id: 'group-1', type: 'chatGroup' },
          expect.objectContaining({ data: { holderId: null }, type: 'lock.changed' }),
        );
      });

      it('does NOT broadcast when the lease expired / was taken over', async () => {
        vi.spyOn(EditLockService.prototype, 'release').mockResolvedValue(false);

        const caller = agentGroupRouter.createCaller(wsCtx());
        await caller.releaseGroupLock({ id: 'group-1' });

        expect(publishResourceEventMock).not.toHaveBeenCalled();
      });
    });
  });
});
