// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { pruneUnansweredGroupTurns } from '../pipeline/historyCleanup';
import { createHistoryMessagesLoader } from '../pipeline/operationPrep';

vi.mock('@/server/services/file', () => ({ FileService: vi.fn(() => ({})) }));

describe('member conversation history scope', () => {
  it.each([{ existingMessageIds: [] }, { existingMessageIds: ['current-message'] }])(
    'does not expand member history into unrelated group topics ($existingMessageIds)',
    async ({ existingMessageIds }) => {
      const current = { id: 'current-message', content: 'Current task', topicId: 'current-topic' };
      const unrelated = { id: 'other-message', content: 'Unrelated task', topicId: 'other-topic' };
      const query = vi.fn(async (_input, options) =>
        options.groupTimeline ? [current, unrelated] : [current],
      );
      const load = createHistoryMessagesLoader(
        {
          db: {} as any,
          groupTimeline: true,
          isShareVisitorRun: false,
          messageModel: { query } as any,
          userId: 'owner',
        },
        {
          appContext: { groupId: 'group', topicId: 'current-topic', orchestrationRole: 'member' },
          effectiveResume: false,
          existingMessageIds,
          resumeParentMessage: undefined,
          selfMessageIds: new Set(),
        },
      );
      expect(await load()).toEqual([current]);
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: 'current-topic' }),
        expect.objectContaining({ groupTimeline: false }),
      );
    },
  );
});

describe('group conversation history cleanup', () => {
  it('removes a failed placeholder together with its unanswered user prompt', () => {
    const messages = [
      { id: 'completed-user', role: 'user', content: 'Completed request' },
      {
        id: 'completed-assistant',
        parentId: 'completed-user',
        role: 'assistant',
        content: 'Completed response',
      },
      { id: 'failed-user', role: 'user', content: 'Old failed instruction' },
      { id: 'failed-assistant', parentId: 'failed-user', role: 'assistant', content: '...' },
    ];

    expect(pruneUnansweredGroupTurns(messages)).toEqual(messages.slice(0, 2));
  });

  it('keeps an intentional ellipsis that already entered the tool pipeline', () => {
    const messages = [
      { id: 'user', role: 'user', content: 'Use a tool' },
      {
        id: 'assistant',
        parentId: 'user',
        role: 'assistant',
        content: '...',
        tool_calls: [],
      },
    ];

    expect(pruneUnansweredGroupTurns(messages)).toEqual(messages);
  });

  it('keeps the user prompt when another assistant branch completed', () => {
    const messages = [
      { id: 'user', role: 'user', content: 'Retry this request' },
      { id: 'failed-assistant', parentId: 'user', role: 'assistant', content: '...' },
      { id: 'completed-assistant', parentId: 'user', role: 'assistant', content: 'Completed' },
    ];

    expect(pruneUnansweredGroupTurns(messages)).toEqual([messages[0], messages[2]]);
  });

  it('applies cleanup when the supervisor loads the group timeline', async () => {
    const messages = [
      { id: 'failed-user', role: 'user', content: 'Old failed instruction' },
      { id: 'failed-assistant', parentId: 'failed-user', role: 'assistant', content: '...' },
      { id: 'completed-assistant', role: 'assistant', content: 'Useful history' },
    ];
    const query = vi.fn(async () => messages);
    const load = createHistoryMessagesLoader(
      {
        db: {} as any,
        groupTimeline: true,
        isShareVisitorRun: false,
        messageModel: { query } as any,
        userId: 'owner',
      },
      {
        appContext: { groupId: 'group', orchestrationRole: 'supervisor' },
        effectiveResume: false,
        existingMessageIds: [],
        resumeParentMessage: undefined,
        selfMessageIds: new Set(),
      },
    );

    expect(await load()).toEqual([messages[2]]);
  });
});
