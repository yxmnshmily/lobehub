import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkDefaultTravelServiceGroup,
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  getDefaultTravelServiceGroupHealthSummary,
  initDefaultTravelServiceGroup,
} from './travelServiceGroup';

const authConfig = vi.hoisted(() => ({ emailVerificationRequired: false }));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    get AUTH_EMAIL_VERIFICATION() {
      return authConfig.emailVerificationRequired;
    },
  },
}));

const {
  ensureAgentByClientId,
  ensureFixedModelSelectionPolicy,
  ensurePlatformManagedModelRuntime,
  ensureByClientId,
  ensureContentIfBlank,
  ensureParticipantAgents,
  ensureSupervisorAgent,
  findAgentByClientId,
  findGroupByClientId,
  getBuiltinAgent,
  getAgentConfigById,
  getGroupAgents,
  getEnabledGroupAgents,
  getSupervisorAgentId,
  removeAgentFromGroup,
  setGroupVisibility,
  updateGroup,
  updateAgentConfig,
  ensureSkillByIdentifier,
  findSkillByIdentifier,
  findUserAccess,
} = vi.hoisted(() => ({
  ensureAgentByClientId: vi.fn(),
  ensureFixedModelSelectionPolicy: vi.fn(),
  ensurePlatformManagedModelRuntime: vi.fn(),
  ensureByClientId: vi.fn(),
  ensureContentIfBlank: vi.fn(),
  ensureParticipantAgents: vi.fn(),
  ensureSupervisorAgent: vi.fn(),
  findAgentByClientId: vi.fn(),
  findGroupByClientId: vi.fn(),
  getBuiltinAgent: vi.fn(),
  getAgentConfigById: vi.fn(),
  getGroupAgents: vi.fn(),
  getEnabledGroupAgents: vi.fn(),
  getSupervisorAgentId: vi.fn(),
  removeAgentFromGroup: vi.fn(),
  setGroupVisibility: vi.fn(),
  updateGroup: vi.fn(),
  updateAgentConfig: vi.fn(),
  ensureSkillByIdentifier: vi.fn(),
  findSkillByIdentifier: vi.fn(),
  findUserAccess: vi.fn(),
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn().mockImplementation(() => ({
    ensureByClientId,
    ensureContentIfBlank,
    ensureParticipantAgents,
    ensureSupervisorAgent,
    findByClientId: findGroupByClientId,
    getGroupAgents,
    getEnabledGroupAgents,
    getSupervisorAgentId,
    removeAgentFromGroup,
    setVisibility: setGroupVisibility,
    update: updateGroup,
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    ensureByClientId: ensureAgentByClientId,
    ensureFixedModelSelectionPolicy,
    ensurePlatformManagedModelRuntime,
    findByClientId: findAgentByClientId,
    getAgentConfigById,
    getBuiltinAgent,
    updateConfig: updateAgentConfig,
  })),
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn().mockImplementation(() => ({
    ensureByIdentifier: ensureSkillByIdentifier,
    findByIdentifier: findSkillByIdentifier,
  })),
}));

describe('getDefaultTravelServiceGroupHealthSummary', () => {
  it('returns only the fixed missing-group summary when the scoped group does not exist', async () => {
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const database = { select } as unknown as LobeChatDatabase;

    const summary = await getDefaultTravelServiceGroupHealthSummary(database, {
      targetUserId: 'target-user',
    });

    expect(summary).toEqual({
      groupCount: 0,
      healthy: false,
      isPrivate: false,
      issueCodes: ['DEFAULT_GROUP_MISSING'],
      requiredMembers: {
        'copywriter': { enabled: false, exists: false, platformManaged: false },
        'designer': { enabled: false, exists: false, platformManaged: false },
        'document-assistant': { enabled: false, exists: false, platformManaged: false },
        'video-producer': { enabled: false, exists: false, platformManaged: false },
      },
      supervisor: { count: 0, platformManaged: false, titleMatches: false },
    });
  });
});

describe('initDefaultTravelServiceGroup', () => {
  const platformManaged = {
    modelRuntimeMode: 'platform-managed',
    modelSelectionPolicy: 'fixed',
  };
  const databaseQuery = { users: { findFirst: findUserAccess } };
  const transactionDatabase = { query: databaseQuery } as unknown as LobeChatDatabase;
  const transaction = vi.fn(async (callback: (tx: LobeChatDatabase) => Promise<unknown>) =>
    callback(transactionDatabase),
  );
  const database = { query: databaseQuery, transaction } as unknown as LobeChatDatabase;

  beforeEach(() => {
    authConfig.emailVerificationRequired = false;
    transaction.mockClear();
    ensureByClientId.mockReset();
    ensureContentIfBlank.mockReset();
    ensureSupervisorAgent.mockReset();
    ensureParticipantAgents.mockReset();
    ensureAgentByClientId.mockReset();
    ensureFixedModelSelectionPolicy.mockReset();
    ensurePlatformManagedModelRuntime.mockReset();
    getBuiltinAgent.mockReset();
    getGroupAgents.mockReset();
    getAgentConfigById.mockReset();
    findAgentByClientId.mockReset();
    findGroupByClientId.mockReset();
    getEnabledGroupAgents.mockReset();
    getSupervisorAgentId.mockReset();
    removeAgentFromGroup.mockReset();
    setGroupVisibility.mockReset();
    updateGroup.mockReset();
    updateAgentConfig.mockReset();
    ensureSkillByIdentifier.mockReset();
    findSkillByIdentifier.mockReset();
    findUserAccess.mockReset();
    findUserAccess.mockResolvedValue({ banExpires: null, banned: false, emailVerified: true });
    ensureByClientId.mockResolvedValue({
      content: null,
      id: 'travel-group',
      visibility: 'private',
    });
    ensureContentIfBlank.mockResolvedValue({ content: 'configured', id: 'travel-group' });
    updateGroup.mockResolvedValue({ content: 'configured', id: 'travel-group' });
    getBuiltinAgent.mockImplementation(async (slug: string) =>
      slug === 'group-supervisor'
        ? { id: 'travel-supervisor' }
        : {
            agencyConfig: {
              modelRuntimeMode: 'platform-managed',
              modelSelectionPolicy: 'fixed',
            },
            id: 'user-inbox',
          },
    );
    getGroupAgents.mockResolvedValue([]);
    ensureSkillByIdentifier
      .mockResolvedValueOnce({ identifier: 'tourism-copywriting' })
      .mockResolvedValueOnce({ identifier: 'tourism-visual-design' })
      .mockResolvedValueOnce({ identifier: 'tourism-video-production' })
      .mockResolvedValueOnce({ identifier: 'tourism-document-production' });
    ensureAgentByClientId
      .mockResolvedValueOnce({ id: 'copy-agent' })
      .mockResolvedValueOnce({ id: 'image-agent' })
      .mockResolvedValueOnce({ id: 'video-agent' })
      .mockResolvedValueOnce({ id: 'document-agent' });
  });

  it('runs the complete initialization inside one database transaction', async () => {
    await initDefaultTravelServiceGroup(database, 'user-a');

    expect(transaction).toHaveBeenCalledOnce();
  });

  it('initializes an unverified user when email verification is disabled', async () => {
    authConfig.emailVerificationRequired = false;
    findUserAccess.mockResolvedValue({ banExpires: null, banned: false, emailVerified: false });

    await expect(initDefaultTravelServiceGroup(database, 'user-a')).resolves.toMatchObject({
      id: 'travel-group',
    });

    expect(ensureByClientId).toHaveBeenCalledOnce();
  });

  it('keeps an unverified user blocked when email verification is enabled', async () => {
    authConfig.emailVerificationRequired = true;
    findUserAccess.mockResolvedValue({ banExpires: null, banned: false, emailVerified: false });

    await expect(initDefaultTravelServiceGroup(database, 'user-a')).resolves.toBeNull();

    expect(ensureByClientId).not.toHaveBeenCalled();
    expect(ensureAgentByClientId).not.toHaveBeenCalled();
  });

  it('ensures one private travel service group with server-locked member slots', async () => {
    await initDefaultTravelServiceGroup(database, 'user-a');

    expect(ensureByClientId).toHaveBeenCalledOnce();
    expect(ensureByClientId).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
        title: '旅游服务超级群组',
        visibility: 'private',
        config: expect.objectContaining({
          memberSlots: [
            expect.objectContaining({
              agentId: 'travel-supervisor',
              configurable: false,
              key: 'travel-owner',
              role: 'supervisor',
              status: 'configured',
            }),
            expect.objectContaining({
              agentId: 'copy-agent',
              configurable: false,
              key: 'copywriter',
              skillSlots: ['tourism-copywriting'],
              status: 'configured',
            }),
            expect.objectContaining({
              agentId: 'image-agent',
              configurable: false,
              key: 'designer',
              skillSlots: ['tourism-visual-design'],
              status: 'configured',
            }),
            expect.objectContaining({
              agentId: 'video-agent',
              configurable: false,
              key: 'video-producer',
              skillSlots: ['tourism-video-production'],
              status: 'configured',
            }),
            expect.objectContaining({
              agentId: 'document-agent',
              configurable: false,
              key: 'document-assistant',
              skillSlots: ['tourism-document-production'],
              status: 'configured',
            }),
          ],
        }),
      }),
    );
    expect(getBuiltinAgent).toHaveBeenCalledWith('group-supervisor');
    expect(getBuiltinAgent).toHaveBeenCalledWith('inbox');
    expect(updateAgentConfig).toHaveBeenCalledWith('travel-supervisor', {
      title: '旅游群主AI',
    });
    expect(ensureSupervisorAgent).toHaveBeenCalledWith('travel-group', 'travel-supervisor');
    expect(ensureContentIfBlank).toHaveBeenCalledWith(
      'travel-group',
      expect.stringContaining('旅游群主AI'),
    );
    expect(ensurePlatformManagedModelRuntime.mock.calls.map(([agentId]) => agentId)).toEqual([
      'travel-supervisor',
      'copy-agent',
      'image-agent',
      'video-agent',
      'document-agent',
    ]);
    expect(updateAgentConfig).not.toHaveBeenCalledWith('user-inbox', expect.anything());
    expect(ensureFixedModelSelectionPolicy).not.toHaveBeenCalled();
    expect(ensureAgentByClientId).toHaveBeenCalledTimes(4);
    for (const [, input] of ensureAgentByClientId.mock.calls) {
      expect(input).toEqual(
        expect.objectContaining({
          agencyConfig: {
            modelRuntimeMode: 'platform-managed',
            modelSelectionPolicy: 'fixed',
          },
        }),
      );
    }
    expect(ensureSkillByIdentifier).toHaveBeenCalledTimes(4);
    expect(ensureAgentByClientId).toHaveBeenNthCalledWith(
      1,
      'default-travel-copywriter',
      expect.objectContaining({
        plugins: ['lobe-travel-production', 'tourism-copywriting'],
      }),
    );
    expect(ensureAgentByClientId).toHaveBeenNthCalledWith(
      2,
      'default-travel-image-designer',
      expect.objectContaining({
        agencyConfig: {
          modelRuntimeMode: 'platform-managed',
          modelSelectionPolicy: 'fixed',
        },
        plugins: ['lobe-travel-production', 'tourism-visual-design'],
      }),
    );
    expect(ensureAgentByClientId).toHaveBeenNthCalledWith(
      3,
      'default-travel-video-producer',
      expect.objectContaining({
        plugins: ['lobe-travel-production', 'tourism-video-production'],
      }),
    );
    expect(ensureAgentByClientId).toHaveBeenNthCalledWith(
      4,
      'default-travel-document-assistant',
      expect.objectContaining({
        plugins: [
          'lobe-travel-production',
          'lobe-agent-documents',
          'tourism-document-production',
        ],
      }),
    );
    expect(ensureParticipantAgents).toHaveBeenCalledWith('travel-group', [
      'copy-agent',
      'image-agent',
      'video-agent',
      'document-agent',
    ]);
  });

  it('repairs every fixed slot field while preserving user-created slots during upgrades', async () => {
    const userSlot = {
      agentId: 'user-created-agent',
      configurable: true,
      key: 'user-created-slot',
      label: '我的自建助理',
      role: 'participant' as const,
      skillSlots: ['my-private-skill'],
      status: 'configured' as const,
    };
    findGroupByClientId.mockResolvedValue({
      config: {
        memberSlots: [
          {
            agentId: 'stale-copy-agent',
            configurable: true,
            key: 'copywriter',
            label: '旧文案槽位',
            role: 'supervisor',
            skillSlots: ['stale-copy-skill'],
            status: 'missing',
          },
          userSlot,
        ],
      },
      id: 'travel-group',
    });

    await initDefaultTravelServiceGroup(database, 'user-a');

    const ensuredGroup = ensureByClientId.mock.calls[0][0];
    expect(ensuredGroup.config?.memberSlots).toContainEqual({
      agentId: 'copy-agent',
      configurable: false,
      key: 'copywriter',
      label: '旅游文案助理',
      role: 'participant',
      skillSlots: ['tourism-copywriting'],
      status: 'configured',
    });
    expect(ensuredGroup.config?.memberSlots).toContainEqual(userSlot);
  });

  it('preserves a user-authored group instruction instead of overwriting it', async () => {
    ensureByClientId.mockResolvedValue({
      content: '用户自定义群规',
      id: 'travel-group',
      visibility: 'private',
    });

    await initDefaultTravelServiceGroup(database, 'user-a');

    expect(updateGroup).not.toHaveBeenCalled();
  });

  it('repairs managed group privacy without overwriting its user-authored name or instructions', async () => {
    ensureByClientId.mockResolvedValue({
      content: '用户自定义群规',
      id: 'travel-group',
      title: '我的旅游制作群',
      visibility: 'public',
    });

    await initDefaultTravelServiceGroup(database, 'user-a');

    expect(setGroupVisibility).toHaveBeenCalledOnce();
    expect(setGroupVisibility).toHaveBeenCalledWith('travel-group', 'private');
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it('repairs drifted specialist titles and prompts from the platform template', async () => {
    findAgentByClientId
      .mockResolvedValueOnce({
        systemRole: '用户自定义文案工作流',
        title: '我的文案助手',
      })
      .mockResolvedValue(undefined);

    await initDefaultTravelServiceGroup(database, 'user-a');

    expect(ensureAgentByClientId).toHaveBeenNthCalledWith(
      1,
      'default-travel-copywriter',
      expect.objectContaining({
        systemRole: '你是旅游文案助理，负责口播、攻略、标题、推文和营销脚本。',
        title: '旅游文案助理',
      }),
    );
    expect(ensureAgentByClientId).toHaveBeenNthCalledWith(
      2,
      'default-travel-image-designer',
      expect.objectContaining({
        systemRole: '你是旅游图片封面助理，负责旅游海报、封面、配图的视觉方案与图像生成。',
        title: '图片封面助理',
      }),
    );
  });

  it('removes the obsolete artifact tool from an existing managed document assistant', async () => {
    ensureAgentByClientId.mockReset();
    ensureAgentByClientId
      .mockResolvedValueOnce({ id: 'copy-agent' })
      .mockResolvedValueOnce({ id: 'image-agent' })
      .mockResolvedValueOnce({ id: 'video-agent' })
      .mockResolvedValueOnce({
        id: 'document-agent',
        plugins: [
          'lobe-artifacts',
          'custom-tool',
          'lobe-travel-production',
          'lobe-agent-documents',
        ],
      });

    await initDefaultTravelServiceGroup(database, 'user-a');

    expect(updateAgentConfig).toHaveBeenCalledWith('document-agent', {
      plugins: ['custom-tool', 'lobe-travel-production', 'lobe-agent-documents'],
    });
  });

  it('removes the direct image tool so a managed image assistant cannot bypass billing', async () => {
    ensureAgentByClientId.mockReset();
    ensureAgentByClientId
      .mockResolvedValueOnce({ id: 'copy-agent' })
      .mockResolvedValueOnce({
        id: 'image-agent',
        plugins: ['lobe-image-generation', 'custom-tool', 'lobe-travel-production'],
      })
      .mockResolvedValueOnce({ id: 'video-agent' })
      .mockResolvedValueOnce({ id: 'document-agent' });

    await initDefaultTravelServiceGroup(database, 'user-a');

    expect(updateAgentConfig).toHaveBeenCalledWith('image-agent', {
      plugins: ['custom-tool', 'lobe-travel-production'],
    });
  });

  it('fails explicitly when the built-in supervisor template is unavailable', async () => {
    getBuiltinAgent.mockImplementation(async (slug: string) =>
      slug === 'group-supervisor' ? null : { id: 'user-inbox' },
    );

    await expect(initDefaultTravelServiceGroup(database, 'user-a')).rejects.toThrow(
      /built-in supervisor agent is unavailable/,
    );
    expect(ensureSupervisorAgent).not.toHaveBeenCalled();
  });

  it('migrates only the recognizable legacy Inbox and preserves another supervisor', async () => {
    getGroupAgents.mockResolvedValue([
      { agentId: 'user-inbox', role: 'supervisor' },
      { agentId: 'stale-supervisor', role: 'supervisor' },
      { agentId: 'copy-agent', role: 'participant' },
    ]);

    await initDefaultTravelServiceGroup(database, 'user-a');

    expect(ensureSupervisorAgent).toHaveBeenCalledWith('travel-group', 'travel-supervisor');
    expect(removeAgentFromGroup).toHaveBeenCalledTimes(1);
    expect(removeAgentFromGroup).toHaveBeenCalledWith('travel-group', 'user-inbox');
    expect(removeAgentFromGroup).not.toHaveBeenCalledWith('travel-group', 'stale-supervisor');
    expect(updateAgentConfig).toHaveBeenCalledWith('user-inbox', {
      agencyConfig: { modelSelectionPolicy: 'member' },
    });
    expect(updateAgentConfig.mock.invocationCallOrder.at(-1)).toBeLessThan(
      removeAgentFromGroup.mock.invocationCallOrder[0],
    );
  });

  it('keeps the legacy Inbox membership as a retry marker when policy restoration fails', async () => {
    getGroupAgents.mockResolvedValue([{ agentId: 'user-inbox', role: 'supervisor' }]);
    updateAgentConfig.mockImplementation(async (agentId: string) => {
      if (agentId === 'user-inbox') throw new Error('database write failed');
    });

    await expect(initDefaultTravelServiceGroup(database, 'user-a')).rejects.toThrow(
      'database write failed',
    );

    expect(ensureSupervisorAgent).toHaveBeenCalledWith('travel-group', 'travel-supervisor');
    expect(removeAgentFromGroup).not.toHaveBeenCalled();
  });

  it('checks that the named users persisted group and five real members are ready', async () => {
    findGroupByClientId.mockResolvedValue({
      content: '旅游群主调度规则',
      id: 'travel-group',
      visibility: 'private',
    });
    findAgentByClientId
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'copy-agent',
        plugins: ['lobe-travel-production', 'tourism-copywriting'],
        systemRole: '你是旅游文案助理，负责口播、攻略、标题、推文和营销脚本。',
        title: '旅游文案助理',
      })
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'image-agent',
        plugins: ['lobe-travel-production', 'tourism-visual-design'],
        systemRole: '你是旅游图片封面助理，负责旅游海报、封面、配图的视觉方案与图像生成。',
        title: '图片封面助理',
      })
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'video-agent',
        plugins: ['lobe-travel-production', 'tourism-video-production'],
        systemRole: '你是旅游视频助理，负责选题、分镜、剪辑脚本、口播与成片制作流程。',
        title: '旅游视频助理',
      })
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'document-agent',
        plugins: [
          'lobe-travel-production',
          'lobe-agent-documents',
          'tourism-document-production',
        ],
        systemRole:
          '你是行程文档助理，负责行程单、方案书、报价单、手册和 Word/PDF 文档内容。',
        title: '行程文档助理',
      });
    findSkillByIdentifier
      .mockResolvedValueOnce({ identifier: 'tourism-copywriting' })
      .mockResolvedValueOnce({ identifier: 'tourism-visual-design' })
      .mockResolvedValueOnce({ identifier: 'tourism-video-production' })
      .mockResolvedValueOnce({ identifier: 'tourism-document-production' });
    getSupervisorAgentId.mockResolvedValue('travel-supervisor');
    getAgentConfigById.mockResolvedValue({
      agencyConfig: {
        modelRuntimeMode: 'platform-managed',
        modelSelectionPolicy: 'fixed',
      },
      slug: 'group-supervisor',
      title: '旅游群主AI',
    });
    getEnabledGroupAgents.mockResolvedValue(
      ['travel-supervisor', 'copy-agent', 'image-agent', 'video-agent', 'document-agent'].map(
        (agentId) => ({ agentId }),
      ),
    );
    getGroupAgents.mockResolvedValue([
      { agentId: 'travel-supervisor', enabled: true, role: 'supervisor' },
    ]);

    await expect(checkDefaultTravelServiceGroup(database, 'user-a')).resolves.toEqual({
      accessState: 'active',
      groupId: 'travel-group',
      groupVisibility: 'private',
      memberCount: 5,
      missingFixedModelSelectionClientIds: [],
      missingPlatformManagedRuntimeClientIds: [],
      missingSpecialistClientIds: [],
      missingSkillBindings: [],
      missingSkillIdentifiers: [],
      missingToolBindings: [],
      ready: true,
      supervisorAgentId: 'travel-supervisor',
      supervisorCount: 1,
      supervisorInstructionsConfigured: true,
      supervisorModelRuntimeMode: 'platform-managed',
      supervisorModelSelectionPolicy: 'fixed',
      supervisorSlug: 'group-supervisor',
      supervisorTitle: '旅游群主AI',
    });
  });

  it('does not report a public default travel group as ready', async () => {
    findGroupByClientId.mockResolvedValue({
      content: '旅游群主调度规则',
      id: 'travel-group',
      visibility: 'public',
    });
    findAgentByClientId.mockResolvedValue({
      agencyConfig: platformManaged,
      id: 'specialist',
      plugins: [
        'lobe-agent-documents',
        'lobe-travel-production',
        'tourism-copywriting',
        'tourism-document-production',
        'tourism-video-production',
        'tourism-visual-design',
      ],
    });
    findSkillByIdentifier.mockResolvedValue({ identifier: 'skill' });
    getSupervisorAgentId.mockResolvedValue('travel-supervisor');
    getAgentConfigById.mockResolvedValue({
      agencyConfig: platformManaged,
      slug: 'group-supervisor',
      title: '旅游群主AI',
    });
    getEnabledGroupAgents.mockResolvedValue([
      { agentId: 'travel-supervisor' },
      { agentId: 'specialist' },
    ]);
    getGroupAgents.mockResolvedValue([{ agentId: 'travel-supervisor', role: 'supervisor' }]);

    await expect(checkDefaultTravelServiceGroup(database, 'user-a')).resolves.toMatchObject({
      groupVisibility: 'public',
      ready: false,
    });
  });

  it('rejects the legacy Inbox even when it still has platform-managed runtime', async () => {
    findGroupByClientId.mockResolvedValue({ content: '旅游群主调度规则', id: 'travel-group' });
    findAgentByClientId.mockResolvedValue({
      agencyConfig: platformManaged,
      id: 'specialist',
      plugins: [
        'lobe-agent-documents',
        'lobe-image-generation',
        'lobe-travel-production',
        'tourism-copywriting',
        'tourism-document-production',
        'tourism-video-production',
        'tourism-visual-design',
      ],
    });
    findSkillByIdentifier.mockResolvedValue({ id: 'skill' });
    getSupervisorAgentId.mockResolvedValue('user-inbox');
    getAgentConfigById.mockResolvedValue({
      agencyConfig: platformManaged,
      slug: 'inbox',
      title: '旅游群主AI',
    });
    getEnabledGroupAgents.mockResolvedValue([{ agentId: 'user-inbox' }, { agentId: 'specialist' }]);
    getGroupAgents.mockResolvedValue([{ agentId: 'user-inbox', role: 'supervisor' }]);

    const result = await checkDefaultTravelServiceGroup(database, 'user-a');

    expect(result.ready).toBe(false);
    expect(result.supervisorSlug).toBe('inbox');
  });

  it('reports a missing skill binding as not ready', async () => {
    findGroupByClientId.mockResolvedValue({ content: '旅游群主调度规则', id: 'travel-group' });
    findAgentByClientId
      .mockResolvedValueOnce({ agencyConfig: platformManaged, id: 'copy-agent', plugins: [] })
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'image-agent',
        plugins: ['lobe-travel-production', 'tourism-visual-design'],
      })
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'video-agent',
        plugins: ['lobe-travel-production', 'tourism-video-production'],
      })
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'document-agent',
        plugins: [
          'lobe-travel-production',
          'lobe-agent-documents',
          'tourism-document-production',
        ],
      });
    findSkillByIdentifier.mockResolvedValue({ id: 'skill' });
    getSupervisorAgentId.mockResolvedValue('user-inbox');
    getAgentConfigById.mockResolvedValue({
      agencyConfig: {
        modelRuntimeMode: 'platform-managed',
        modelSelectionPolicy: 'fixed',
      },
    });
    getEnabledGroupAgents.mockResolvedValue(
      ['user-inbox', 'copy-agent', 'image-agent', 'video-agent', 'document-agent'].map(
        (agentId) => ({ agentId }),
      ),
    );
    getGroupAgents.mockResolvedValue([{ agentId: 'user-inbox', role: 'supervisor' }]);

    const result = await checkDefaultTravelServiceGroup(database, 'user-a');

    expect(result.ready).toBe(false);
    expect(result.missingSkillBindings).toEqual(['tourism-copywriting']);
  });

  it('reports a specialist that lost the protected server runtime as not ready', async () => {
    findGroupByClientId.mockResolvedValue({ content: '旅游群主调度规则', id: 'travel-group' });
    findAgentByClientId
      .mockResolvedValueOnce({
        agencyConfig: { modelSelectionPolicy: 'fixed' },
        id: 'copy-agent',
        plugins: ['lobe-travel-production', 'tourism-copywriting'],
      })
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'image-agent',
        plugins: ['lobe-travel-production', 'tourism-visual-design'],
      })
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'video-agent',
        plugins: ['lobe-travel-production', 'tourism-video-production'],
      })
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'document-agent',
        plugins: [
          'lobe-travel-production',
          'lobe-agent-documents',
          'tourism-document-production',
        ],
      });
    findSkillByIdentifier.mockResolvedValue({ id: 'skill' });
    getSupervisorAgentId.mockResolvedValue('travel-supervisor');
    getAgentConfigById.mockResolvedValue({
      agencyConfig: platformManaged,
      slug: 'group-supervisor',
      title: '旅游群主AI',
    });
    getEnabledGroupAgents.mockResolvedValue(
      ['travel-supervisor', 'copy-agent', 'image-agent', 'video-agent', 'document-agent'].map(
        (agentId) => ({ agentId }),
      ),
    );
    getGroupAgents.mockResolvedValue([{ agentId: 'travel-supervisor', role: 'supervisor' }]);

    const result = await checkDefaultTravelServiceGroup(database, 'user-a');

    expect(result.ready).toBe(false);
    expect(result.missingPlatformManagedRuntimeClientIds).toEqual(['default-travel-copywriter']);
  });

  it('reports a disabled managed member and missing video tool binding as not ready', async () => {
    findGroupByClientId.mockResolvedValue({ content: '旅游群主调度规则', id: 'travel-group' });
    findAgentByClientId
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'copy-agent',
        plugins: ['lobe-travel-production', 'tourism-copywriting'],
      })
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'image-agent',
        plugins: ['lobe-travel-production', 'tourism-visual-design'],
      })
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'video-agent',
        plugins: ['tourism-video-production'],
      })
      .mockResolvedValueOnce({
        agencyConfig: platformManaged,
        id: 'document-agent',
        plugins: [
          'lobe-travel-production',
          'lobe-agent-documents',
          'tourism-document-production',
        ],
      });
    findSkillByIdentifier.mockResolvedValue({ id: 'skill' });
    getSupervisorAgentId.mockResolvedValue('user-inbox');
    getAgentConfigById.mockResolvedValue({
      agencyConfig: {
        modelRuntimeMode: 'platform-managed',
        modelSelectionPolicy: 'fixed',
      },
    });
    getEnabledGroupAgents.mockResolvedValue(
      ['user-inbox', 'copy-agent', 'image-agent', 'document-agent'].map((agentId) => ({ agentId })),
    );
    getGroupAgents.mockResolvedValue([{ agentId: 'user-inbox', role: 'supervisor' }]);

    const result = await checkDefaultTravelServiceGroup(database, 'user-a');

    expect(result.ready).toBe(false);
    expect(result.missingToolBindings).toEqual(['lobe-travel-production']);
  });

  it('reports duplicate supervisor relationships as not ready', async () => {
    findGroupByClientId.mockResolvedValue({ content: '旅游群主调度规则', id: 'travel-group' });
    findAgentByClientId.mockResolvedValue({
      agencyConfig: platformManaged,
      id: 'specialist',
      plugins: [
        'lobe-agent-documents',
        'lobe-image-generation',
        'lobe-travel-production',
        'tourism-copywriting',
        'tourism-document-production',
        'tourism-video-production',
        'tourism-visual-design',
      ],
    });
    findSkillByIdentifier.mockResolvedValue({ id: 'skill' });
    getSupervisorAgentId.mockResolvedValue('travel-supervisor');
    getAgentConfigById.mockResolvedValue({
      agencyConfig: platformManaged,
      slug: 'group-supervisor',
      title: '旅游群主AI',
    });
    getEnabledGroupAgents.mockResolvedValue([
      { agentId: 'travel-supervisor' },
      { agentId: 'user-inbox' },
      { agentId: 'specialist' },
    ]);
    getGroupAgents.mockResolvedValue([
      { agentId: 'travel-supervisor', role: 'supervisor' },
      { agentId: 'user-inbox', role: 'supervisor' },
    ]);

    const result = await checkDefaultTravelServiceGroup(database, 'user-a');

    expect(result.ready).toBe(false);
    expect(result.supervisorCount).toBe(2);
  });
});
