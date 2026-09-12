// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

import { executeMessengerGroup } from './groupExecution';

const mocks = vi.hoisted(() => ({
  group: vi.fn(),
  supervisor: vi.fn(),
  topic: vi.fn(),
  target: vi.fn(),
  runBudget: vi.fn(),
  config: vi.fn(),
}));
vi.mock('@/envs/auth', () => ({ authEnv: { AUTH_SECRET: 'test-only-secret' } }));
vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getAgentConfigById = mocks.config;
  },
}));
vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: class {
    findById = mocks.group;
    getSupervisorAgentId = mocks.supervisor;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = mocks.topic;
  },
}));
vi.mock('@/server/services/platformUsageBilling/groupChat', () => ({
  resolveHostedTravelGroupTarget: mocks.target,
  runHostedGroupChatWithBudget: mocks.runBudget,
}));
vi.mock('@/server/services/user/travelServiceGroup', () => ({
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID: 'hosted',
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.group.mockResolvedValue({ id: 'group-1', userId: 'user-1', clientId: null });
  mocks.supervisor.mockResolvedValue('supervisor-1');
});

it('routes hosted workgroups through budget authorization, never ordinary agent execution', async () => {
  mocks.group.mockResolvedValue({ id: 'group-1', userId: 'user-1', clientId: 'hosted' });
  mocks.target.mockResolvedValue({ principal: { actorUserId: 'user-1' } });
  mocks.config.mockResolvedValue({ model: 'configured-model', provider: 'configured-provider' });
  mocks.runBudget.mockImplementation(({ start }) => start({ authorization: 'server-grant' }));
  const execAgent = vi.fn();
  const execPlatformManagedAgent = vi.fn().mockResolvedValue({ success: true });
  await executeMessengerGroup({
    db: {} as any,
    userId: 'user-1',
    groupId: 'group-1',
    requestKey: 'msg-hosted',
    service: { execAgent, execPlatformManagedAgent } as any,
    params: { agentId: 'supervisor-1', prompt: '文案' } as any,
  });
  expect(mocks.runBudget).toHaveBeenCalledWith(
    expect.objectContaining({ billing: { idempotencyKey: 'msg-hosted' } }),
  );
  expect(execAgent).not.toHaveBeenCalled();
  expect(execPlatformManagedAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      appContext: { groupId: 'group-1', orchestrationRole: 'supervisor' },
    }),
    expect.objectContaining({
      authorization: 'server-grant',
      actorUserId: 'user-1',
      resourceOwnerUserId: 'user-1',
    }),
  );
});

it('executes in group context while preserving callbacks and attachments', async () => {
  const execAgent = vi.fn().mockResolvedValue({ success: true });
  const hooks = [{ id: 'reply' }];
  await executeMessengerGroup({
    db: {} as any,
    userId: 'user-1',
    groupId: 'group-1',
    requestKey: 'msg-1',
    service: { execAgent } as any,
    params: {
      agentId: 'supervisor-1',
      prompt: '制作文案',
      hooks,
      files: [{ id: 'file-1' }],
    } as any,
  });
  expect(execAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      appContext: { groupId: 'group-1', orchestrationRole: 'supervisor' },
      hooks,
      files: [{ id: 'file-1' }],
    }),
  );
});

it('rejects a stale supervisor before starting execution', async () => {
  mocks.supervisor.mockResolvedValue('new-supervisor');
  const execAgent = vi.fn();
  await expect(
    executeMessengerGroup({
      db: {} as any,
      userId: 'user-1',
      groupId: 'group-1',
      requestKey: 'msg-1',
      service: { execAgent } as any,
      params: { agentId: 'old-supervisor' } as any,
    }),
  ).rejects.toThrow();
  expect(execAgent).not.toHaveBeenCalled();
});

it('rejects cross-group conversation reuse', async () => {
  mocks.topic.mockResolvedValue({ groupId: 'another-group', agentId: 'supervisor-1' });
  const execAgent = vi.fn();
  await expect(
    executeMessengerGroup({
      db: {} as any,
      userId: 'user-1',
      groupId: 'group-1',
      requestKey: 'msg-1',
      service: { execAgent } as any,
      params: { agentId: 'supervisor-1', appContext: { topicId: 'topic-other' } } as any,
    }),
  ).rejects.toThrow();
  expect(execAgent).not.toHaveBeenCalled();
});
