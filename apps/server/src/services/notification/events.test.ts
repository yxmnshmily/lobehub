// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

import {
  notifyAgentRunCompleted,
  notifyAgentRunFailed,
} from '@/business/server/agent-run/notifyAgentRunCompleted';
import { notifyImageCompleted } from '@/business/server/image-generation/notifyImageCompleted';
import {
  notifyScheduledTaskCompleted,
  notifyScheduledTaskFailed,
} from '@/business/server/task/notifyScheduledTaskResult';
import { notifyVideoCompleted } from '@/business/server/video-generation/notifyVideoCompleted';

const emit = vi.hoisted(() => vi.fn(async (_event: unknown) => {}));
vi.mock('./index', () => ({ notifyUser: emit }));
beforeEach(() => emit.mockClear());
it.each([
  [
    notifyImageCompleted,
    {
      duration: 100,
      generationBatchId: 'batch',
      model: 'm',
      prompt: 'private prompt',
      topicId: 'topic',
    },
    'image_generation_completed',
    '/image?topic=topic',
  ],
  [
    notifyVideoCompleted,
    { generationBatchId: 'batch', model: 'm', prompt: 'private prompt', topicId: 'topic' },
    'video_generation_completed',
    '/video?topic=topic',
  ],
  [
    notifyScheduledTaskCompleted,
    { operationId: 'op', taskId: 'task', taskIdentifier: 'T-1' },
    'agent_cron_job_completed',
    '/task/task',
  ],
  [
    notifyScheduledTaskFailed,
    { operationId: 'op', taskId: 'task', taskIdentifier: 'T-1', runTrigger: 'schedule' },
    'agent_cron_job_failed',
    '/task/task',
  ],
  [
    notifyAgentRunCompleted,
    { operationId: 'group-op', agentId: 'agent', groupId: 'group', topicId: 'topic' },
    'agent_run_completed',
    '/group/group#topic:topic',
  ],
  [
    notifyAgentRunCompleted,
    {
      operationId: 'op',
      agentId: 'agent',
      topicId: 'topic',
      lastAssistantContent: 'private response',
    },
    'agent_run_completed',
    '/agent/agent?topic=topic',
  ],
] as const)(
  'emits %s with the original recipient and navigable result link',
  async (notify, params, type, actionUrl) => {
    await (notify as (params: any) => Promise<void>)({
      ...params,
      userId: 'owner',
      workspaceId: 'workspace',
    });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner', workspaceId: 'workspace', type, actionUrl }),
    );
    expect(JSON.stringify(emit.mock.calls)).not.toContain('private');
  },
);

it('notifies failed interactive runs with the correct group conversation link', async () => {
  await notifyAgentRunFailed({
    userId: 'owner',
    operationId: 'failed-op',
    groupId: 'group',
    topicId: 'topic',
  });
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'agent_run_failed', actionUrl: '/group/group#topic:topic' }),
  );
});
