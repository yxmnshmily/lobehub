// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

import { notifyAgentInterventionRequired } from '@/business/server/agent-run/agentInterventionReview';
import { notifyResourceTransfer } from '@/business/server/resource-transfer/notify';
import { notifyTaskAssigned } from '@/business/server/task/notifyTaskAssigned';
import { notifyTaskCommentActivity } from '@/business/server/task/notifyTaskCommentActivity';
import { notifyTopicCommentActivity } from '@/business/server/topic-comment/notifyActivity';
import { notifyTopicCommentModeration } from '@/business/server/topic-comment/notifyModeration';

const emit = vi.hoisted(() => vi.fn(async (_event: any) => {}));
vi.mock('./topicContext', () => ({ topicNotificationUrl: async () => '/agent/agent?topic=topic' }));
vi.mock('./index', () => ({ notifyUser: emit }));
beforeEach(() => emit.mockClear());

it('notifies the assigned member, suppressing self-assignment', async () => {
  const params = {
    actorUserId: 'author',
    assigneeUserId: 'member',
    taskId: 'task',
    taskIdentifier: 'T-1',
    workspaceId: 'ws',
  };
  await notifyTaskAssigned(params);
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'member', type: 'task_assigned', actionUrl: '/task/task' }),
  );
  emit.mockClear();
  await notifyTaskAssigned({ ...params, assigneeUserId: 'author' });
  expect(emit).not.toHaveBeenCalled();
});

it('deduplicates comment recipients, prioritizes mentions, and never notifies the author', async () => {
  await notifyTaskCommentActivity({
    actorUserId: 'author',
    taskId: 'task',
    commentId: 'comment',
    workspaceId: 'ws',
    recipients: [
      { userId: 'member', kind: 'commented' },
      { userId: 'member', kind: 'mentioned' },
      { userId: 'author', kind: 'mentioned' },
    ],
  });
  expect(emit).toHaveBeenCalledOnce();
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'member', type: 'task_mentioned' }),
  );
});

it('links a transfer notice to its live pending card and sends outcomes to the initiator', async () => {
  const params = {
    workspaceId: 'ws',
    requestId: 'request',
    resourceId: 'agent',
    resourceType: 'agent' as const,
    initiatorId: 'owner',
    recipientId: 'recipient',
  };
  await notifyResourceTransfer({ ...params, event: 'requested' });
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'recipient',
      type: 'resource_transfer_requested',
      metadata: { transfer: { requestId: 'request' } },
    }),
  );
  emit.mockClear();
  await notifyResourceTransfer({ ...params, event: 'declined' });
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'owner', type: 'resource_transfer_declined' }),
  );
});

it('recalls a pending native or remote review without leaking arguments or issuing approval tokens', async () => {
  await notifyAgentInterventionRequired({
    userId: 'owner',
    workspaceId: 'ws',
    batch: { id: 'batch', activityKey: 'activity', sealed: true },
    context: { groupId: 'group', topicId: 'topic', operationId: 'op' },
    items: [{ summary: 'private', request: { secret: 'value' } }],
    summary: 'private',
  } as any);
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'owner',
      type: 'agent_intervention_required',
      actionUrl: '/group/group#topic:topic',
    }),
  );
  expect(JSON.stringify(emit.mock.calls)).not.toMatch(/private|secret|reviewToken/);
});

it('sends topic activity only once per recipient and links to the authorized conversation', async () => {
  await notifyTopicCommentActivity({
    actorUserId: 'author',
    topicId: 'topic',
    commentId: 'comment',
    rootCommentId: 'root',
    workspaceId: 'ws',
    recipients: [
      { userId: 'member', kind: 'replied' },
      { userId: 'member', kind: 'mentioned' },
      { userId: 'author', kind: 'mentioned' },
    ],
  });
  expect(emit).toHaveBeenCalledOnce();
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'member',
      type: 'topic_mentioned',
      actionUrl: '/agent/agent?topic=topic',
    }),
  );
});
it.each(['removed', 'restored'] as const)(
  'notifies the comment author when moderation is %s',
  async (event) => {
    await notifyTopicCommentModeration({
      authorUserId: 'author',
      commentId: 'comment',
      event,
      eventId: 'revision',
      rootCommentId: 'root',
      topicId: 'topic',
      workspaceId: 'ws',
    });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'author', type: `comment_${event}`, eventId: 'revision' }),
    );
  },
);
