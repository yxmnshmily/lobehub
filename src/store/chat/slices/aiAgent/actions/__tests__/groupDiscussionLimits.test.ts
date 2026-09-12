import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentGroupStore } from '@/store/agentGroup';
import { createGroupOrchestrationExecutors } from '@/store/chat/agents/GroupOrchestration';

import { GroupOrchestrationActionImpl } from '../groupOrchestration';

vi.mock('@/store/chat/agents/GroupOrchestration', () => ({
  createGroupOrchestrationExecutors: vi.fn(),
}));

beforeEach(() => {
  useAgentGroupStore.setState({
    groupMap: {
      group: { id: 'group', config: { maxDiscussionRounds: 2 } } as any,
    },
  });
});

function setup(threadId?: string) {
  const controller = new AbortController();
  const operation = { abortController: controller, context: {}, status: 'running' };
  const store: any = {
    activeGroupId: 'group',
    activeThreadId: threadId,
    operations: { op: operation },
    startOperation: () => ({ operationId: 'op' }),
    completeOperation: vi.fn(),
    failOperation: vi.fn(),
  };
  const speakers: string[] = [];
  vi.mocked(createGroupOrchestrationExecutors).mockReturnValue({
    call_agent: async (instruction: any, state: any) => {
      speakers.push(instruction.payload.agentId);
      return { events: [], newState: state, result: { type: 'agent_spoke', payload: {} } } as any;
    },
    call_supervisor: async (_instruction: any, state: any) =>
      ({
        events: [],
        newState: state,
        result: {
          type: 'supervisor_decided',
          payload: {
            decision: 'speak',
            params: { agentId: speakers.length % 2 ? 'reviewer' : 'writer' },
          },
        },
      }) as any,
  });
  const actions = new GroupOrchestrationActionImpl(
    () => {},
    () => store,
  );
  const run = () =>
    actions.internal_execGroupOrchestration({
      groupId: 'group',
      supervisorAgentId: 'supervisor',
      topicId: 'topic',
      initialResult: {
        type: 'supervisor_decided',
        payload: {
          decision: 'speak',
          params: { agentId: 'writer' },
        },
      },
    });
  return { run, speakers, store, operation, controller };
}

describe('discussion settings consumed by client orchestration', () => {
  it('runs writer then reviewer and finishes at the saved limit', async () => {
    const { run, speakers, store } = setup();
    expect((await run()).status).toBe('done');
    expect(speakers).toEqual(['writer', 'reviewer']);
    expect(store.completeOperation).toHaveBeenCalledWith('op');
  });

  it('keeps the existing task-thread allowance instead of the shorter discussion limit', async () => {
    const { run, speakers } = setup('task-thread');
    await run();
    expect(speakers).toHaveLength(10);
  });

  it('does not start members or report success for a cancelled operation', async () => {
    const { run, speakers, store, operation, controller } = setup();
    operation.status = 'cancelled';
    controller.abort();
    expect((await run()).status).toBe('interrupted');
    expect(speakers).toEqual([]);
    expect(store.completeOperation).not.toHaveBeenCalled();
  });
});
