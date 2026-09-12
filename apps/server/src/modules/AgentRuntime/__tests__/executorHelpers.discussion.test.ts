import { InsertChatGroupSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import { AgentStateManager } from '../AgentStateManager';
import { buildServerAgentMemberRunner } from '../executorHelpers';

vi.mock('../redis', () => {
  const records = new Map<string, string>();
  return {
    getAgentRuntimeRedisClient: () => ({
      setex: async (key: string, _ttl: number, value: string) => {
        records.set(key, value);
      },
      get: async (key: string) => records.get(key),
      hmset: async () => {},
      expire: async () => {},
    }),
  };
});

function setup(maxDiscussionRounds = 2) {
  const state: any = {
    metadata: {
      agentId: 'supervisor',
      agentGroup: { maxDiscussionRounds },
      groupId: 'group',
    },
    status: 'running',
  };
  let count = 0;
  const ctx: any = {
    execGroupMember: vi.fn().mockResolvedValue({ started: true }),
    loadAgentState: vi.fn().mockResolvedValue({ status: 'running' }),
    messageModel: {
      create: vi.fn().mockImplementation(async () => ({ id: `anchor-${++count}` })),
      deleteMessage: vi.fn(),
      findById: vi.fn(),
      updateToolMessage: vi.fn(),
    },
    operationId: 'op',
    topicId: 'topic',
  };
  const build = (current = state) =>
    buildServerAgentMemberRunner(ctx, current, { id: 'call' } as any, 'parent')!;
  const speak = {
    members: [{ agentId: 'writer' }],
    mode: 'in_group' as const,
    onComplete: 'resume' as const,
  };
  return { build, ctx, speak, state };
}

describe('group discussion dispatch bounds', () => {
  it('reports blocked member configuration instead of hiding the startup failure', async () => {
    const { build, ctx, speak } = setup();
    ctx.execGroupMember.mockRejectedValue(
      new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          '该成员已加入默认群，运行配置待管理员完成：原工具或技能资源待发布：private-resource',
      }),
    );
    const result = await build().run(speak);
    expect(result).toMatchObject({ started: false, startedCount: 0 });
    expect(result.error).toContain('writer');
    expect(result.error).toContain('技能资源发布状态');
    expect(result.error).toContain('不要重复调用');
    expect(result.error).not.toContain('private-resource');
    expect(ctx.messageModel.deleteMessage).toHaveBeenCalledWith('anchor-1', expect.anything());
  });

  it('keeps a failed member reason on its anchor when other members start', async () => {
    const { build, ctx, speak } = setup();
    ctx.execGroupMember.mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' }));
    const result = await build().run({
      ...speak,
      members: [{ agentId: 'writer' }, { agentId: 'reviewer' }],
    });
    expect(result).toMatchObject({ started: true, startedCount: 1 });
    expect(ctx.messageModel.updateToolMessage).toHaveBeenCalledWith(
      'anchor-2',
      expect.objectContaining({
        content: expect.stringContaining('执行权限'),
        pluginState: { status: 'error' },
      }),
    );
    expect(ctx.messageModel.deleteMessage).not.toHaveBeenCalled();
  });

  it.each(['throw', 'result'])(
    'redacts unknown %s errors while reporting failure',
    async (kind) => {
      const { build, ctx, speak } = setup();
      if (kind === 'throw') ctx.execGroupMember.mockRejectedValue(new Error('secret-token-123'));
      else ctx.execGroupMember.mockResolvedValue({ started: false, error: 'secret-token-123' });
      const result = await build().run(speak);
      expect(result.error).toContain('启动异常');
      expect(JSON.stringify(result)).not.toContain('secret-token-123');
      expect(JSON.stringify(ctx.messageModel.updateToolMessage.mock.calls)).not.toContain(
        'secret-token-123',
      );
    },
  );

  it('finishes at the configured round and retains the count across restored runtime state', async () => {
    const { build, ctx, speak, state } = setup();
    await build().run(speak);
    expect(ctx.execGroupMember.mock.calls[0][0].onComplete).toBe('resume');
    const manager = new AgentStateManager();
    await manager.saveAgentState('op', state);
    await build(await manager.loadAgentState('op')).run(speak);
    expect(ctx.execGroupMember.mock.calls[1][0].onComplete).toBe('finish');
  });

  it.each([0, 11, 1.5, '2'])(
    'rejects invalid discussion limit %s at the group update boundary',
    (value) => {
      expect(
        InsertChatGroupSchema.partial().safeParse({ config: { maxDiscussionRounds: value } })
          .success,
      ).toBe(false);
    },
  );

  it('does not dispatch or create placeholders beyond the cap', async () => {
    const { build, ctx, speak } = setup(1);
    await build().run(speak);
    await build().run(speak);
    expect(ctx.execGroupMember).toHaveBeenCalledTimes(1);
    expect(ctx.messageModel.create).toHaveBeenCalledTimes(1);
  });

  it('counts a parallel broadcast once and finishes all members together', async () => {
    const { build, ctx, speak } = setup(1);
    await build().run({ ...speak, members: [{ agentId: 'writer' }, { agentId: 'reviewer' }] });
    expect(ctx.execGroupMember).toHaveBeenCalledTimes(2);
    expect(ctx.execGroupMember.mock.calls.map(([p]: any) => p.onComplete)).toEqual([
      'finish',
      'finish',
    ]);
    expect(ctx.messageModel.create.mock.calls[0][0].pluginState.onComplete).toBe('finish');
  });

  it('forwards only a validated cross-agent reply target from the same group topic', async () => {
    const { build, ctx, speak } = setup();
    ctx.messageModel.findById.mockResolvedValue({
      agentId: 'writer',
      groupId: 'group',
      id: 'msg_A',
      role: 'assistant',
      topicId: 'topic',
    });

    await build().run({
      ...speak,
      members: [
        {
          agentId: 'reviewer',
          replyToMessageId: 'msg%5FA',
        },
      ],
    } as any);

    expect(ctx.messageModel.findById).toHaveBeenCalledWith('msg_A');
    expect(ctx.execGroupMember).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'reviewer',
        replyToMessageId: 'msg_A',
      }),
    );
  });

  it.each([
    ['the target belongs to the responding agent', { agentId: 'reviewer' }],
    ['the target belongs to another group', { agentId: 'writer', groupId: 'other-group' }],
    ['the target belongs to another topic', { agentId: 'writer', topicId: 'other-topic' }],
    ['the target is not an assistant message', { agentId: 'writer', role: 'user' }],
  ])('drops the reply target when %s', async (_label, overrides) => {
    const { build, ctx, speak } = setup();
    ctx.messageModel.findById.mockResolvedValue(
      Object.assign(
        {
          agentId: 'writer',
          groupId: 'group',
          id: 'msg_A',
          role: 'assistant',
          topicId: 'topic',
        },
        overrides,
      ),
    );

    await build().run({
      ...speak,
      members: [{ agentId: 'reviewer', replyToMessageId: 'msg_A' }],
    } as any);

    expect(ctx.execGroupMember.mock.calls[0]?.[0]).not.toHaveProperty('replyToMessageId');
  });

  it('does not launch another member after the supervisor has been stopped', async () => {
    const { build, ctx, speak } = setup();
    ctx.loadAgentState.mockResolvedValue({ status: 'interrupted' });
    await build().run(speak);
    expect(ctx.execGroupMember).not.toHaveBeenCalled();
    expect(ctx.messageModel.create).not.toHaveBeenCalled();
  });

  it('does not launch when stopped while preparing the member placeholder', async () => {
    const { build, ctx, speak } = setup();
    ctx.messageModel.create.mockImplementationOnce(async () => {
      ctx.loadAgentState.mockResolvedValue({ status: 'interrupted' });
      return { id: 'pending-anchor' };
    });
    await build().run(speak);
    expect(ctx.execGroupMember).not.toHaveBeenCalled();
    expect(ctx.messageModel.deleteMessage).toHaveBeenCalledWith(
      'pending-anchor',
      expect.anything(),
    );
  });

  it.each(['missing', 'unavailable'])(
    'does not start paid member work when parent state is %s',
    async (kind) => {
      const { build, ctx, speak } = setup();
      if (kind === 'missing') ctx.loadAgentState.mockResolvedValue(undefined);
      else ctx.loadAgentState.mockRejectedValue(new Error('state unavailable'));
      await build().run(speak);
      expect(ctx.execGroupMember).not.toHaveBeenCalled();
      expect(ctx.messageModel.create).not.toHaveBeenCalled();
    },
  );

  it('reserves the final round only once for simultaneous tool calls', async () => {
    const { build, ctx, speak } = setup(1);
    await Promise.all([build().run(speak), build().run(speak)]);
    expect(ctx.execGroupMember).toHaveBeenCalledTimes(1);
  });

  it('does not apply conversational round limits to existing isolated tasks or task executions', async () => {
    const { build, ctx, speak, state } = setup(1);
    await build().run({ ...speak, mode: 'isolated' });
    state.metadata.taskId = 'task';
    await build().run(speak);
    expect(ctx.execGroupMember.mock.calls.map(([p]: any) => p.onComplete)).toEqual([
      'resume',
      'resume',
    ]);
  });
});
