import { describe, expect, it, vi } from 'vitest';

import { buildServerAgentMemberRunner } from '../executorHelpers';

describe('buildServerAgentMemberRunner member tool policy', () => {
  it('passes only the server-owned policy selected for the resolved member', async () => {
    const execGroupMember = vi.fn().mockResolvedValue({ started: true });
    const messageModel = {
      create: vi.fn().mockResolvedValue({ id: 'group-tool-message' }),
    };
    const policy = {
      cursor: 0,
      steps: [
        {
          apiName: 'generateVideo',
          arguments: JSON.stringify({ prompt: '旅游视频' }),
          identifier: 'lobe-travel-production',
          toolName: 'lobe-travel-production____generateVideo',
        },
      ],
      version: 1 as const,
    };
    const runner = buildServerAgentMemberRunner(
      {
        execGroupMember,
        messageModel,
        operationId: 'supervisor-operation',
        topicId: 'topic-1',
      } as any,
      {
        metadata: {
          agentId: 'supervisor-agent',
          agentGroup: { agentMap: { 'video-agent': { name: '旅游视频助理' } } },
          groupId: 'travel-group',
        },
      } as any,
      { apiName: 'speak', id: 'call-1', identifier: 'lobe-group-management' } as any,
      'supervisor-message',
      { 'video-agent': policy },
    );

    await runner!.run({
      members: [{ agentId: '旅游视频助理', instruction: '生成视频' }],
      mode: 'in_group',
      onComplete: 'resume',
    });

    expect(execGroupMember).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'video-agent',
        supervisorMessageId: 'supervisor-message',
        toolDispatchPolicy: policy,
      }),
    );
    expect(execGroupMember.mock.calls[0]?.[0]).not.toHaveProperty(
      'platformManagedExecutionAuthorized',
    );
    expect(execGroupMember.mock.calls[0]?.[0]).not.toHaveProperty('platformManagedMaxCredits');
  });
});
