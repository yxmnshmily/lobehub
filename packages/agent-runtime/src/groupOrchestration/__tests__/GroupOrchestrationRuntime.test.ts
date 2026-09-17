import { describe, expect, it, vi } from 'vitest';

import { GroupOrchestrationRuntime } from '../GroupOrchestrationRuntime';

describe('group orchestration stop boundary', () => {
  it.each(['before', 'during'] as const)(
    'does not dispatch when stopped %s the supervisor decision',
    async (when) => {
      const controller = new AbortController();
      if (when === 'before') controller.abort();
      const executor = vi.fn(async (_instruction, state) => ({ events: [], newState: state }));
      const supervisor = {
        decide: vi.fn(async () => {
          if (when === 'during') controller.abort();
          return { payload: { agentId: 'member' }, type: 'call_agent' as const };
        }),
      };
      const runtime = new GroupOrchestrationRuntime(supervisor, {
        executors: { call_agent: executor },
        getOperation: () => ({ abortController: controller, context: {} }),
        operationId: 'op',
      });
      const result = await runtime.step(
        GroupOrchestrationRuntime.createInitialState({ operationId: 'op' }),
        {
          payload: {},
          type: 'init',
        },
      );
      expect(executor).not.toHaveBeenCalled();
      expect(result.newState.status).toBe('interrupted');
      expect(result.result).toBeUndefined();
    },
  );
});
