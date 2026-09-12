import type { ContextBuildInput } from '@lobechat/agent-runtime';
import { AgentRuntime } from '@lobechat/agent-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { ServerContextBuilder } from './ServerContextBuilder';

const mocks = vi.hoisted(() => ({ build: vi.fn(), model: vi.fn() }));
vi.mock('./serverCallLlmContextBuilder', () => ({ buildServerCallLlmContext: mocks.build }));
vi.mock('./serverCallLlmTooling', () => ({
  resolveServerCallLlmTooling: () => ({ resolved: { tools: [] } }),
}));
vi.mock('@lobechat/model-runtime', () => ({
  getModelPropertyWithFallback: mocks.model,
  isDeepSeekV4FamilyModel: () => false,
}));

describe('ServerContextBuilder group budget', () => {
  const messages = [
    { content: 'old history '.repeat(5000), id: 'old', role: 'user' },
    { content: 'current task', id: 'current', role: 'user' },
  ];
  const wireMessages = messages.map(({ content, role }) => ({ content, role }));
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.model.mockResolvedValue(4000);
    mocks.build.mockResolvedValue({
      messageSourceIds: ['old', 'current'],
      processedMessages: wireMessages,
    });
  });
  const input = (metadata = { groupId: 'group' }): ContextBuildInput => ({
    model: 'model',
    payload: { messages, model: 'model', provider: 'provider', tools: [] },
    provider: 'provider',
    state: AgentRuntime.createInitialState({ metadata, operationId: 'operation' }),
  });

  it('budgets the final injected payload only for authorized main group runs', async () => {
    const ctx = { platformManagedExecutionAuthorized: true } as RuntimeExecutorContext;
    const result = await new ServerContextBuilder(ctx).build(input());
    expect(result.messages).toEqual([wireMessages[1]]);
    expect(result.messages[0]).not.toHaveProperty('id');
    expect(messages).toHaveLength(2);
    expect(mocks.model).toHaveBeenCalledWith('model', 'contextWindowTokens', 'provider');
  });

  it('uses pre-transform user identities instead of a peer reply transformed to user', async () => {
    const request = input();
    request.payload.messages = [
      { content: messages[0].content, id: 'current', role: 'user' },
      { content: 'peer result', id: 'peer', role: 'assistant' },
    ] as any;
    mocks.build.mockResolvedValue({
      messageSourceIds: ['current', 'peer'],
      processedMessages: [
        { content: request.payload.messages[0].content, role: 'user' },
        { content: 'peer result', role: 'user' },
      ],
    });
    const ctx = { platformManagedExecutionAuthorized: true } as RuntimeExecutorContext;
    await expect(new ServerContextBuilder(ctx).build(request)).rejects.toThrow('当前任务');
  });

  it.each([
    [{}, { groupId: 'group' }],
    [{ platformManagedExecutionAuthorized: true }, {}],
    [{ platformManagedExecutionAuthorized: true }, { groupId: 'group', threadId: 'thread' }],
    [{ platformManagedExecutionAuthorized: true, agentShareVisitor: {} }, { groupId: 'group' }],
  ])('does not change ordinary, visitor or delegated contexts: %j', async (ctx, metadata) => {
    const result = await new ServerContextBuilder(ctx as RuntimeExecutorContext).build(
      input(metadata as any),
    );
    expect(result.messages).toBe(wireMessages);
    expect(mocks.model).not.toHaveBeenCalled();
  });
});
