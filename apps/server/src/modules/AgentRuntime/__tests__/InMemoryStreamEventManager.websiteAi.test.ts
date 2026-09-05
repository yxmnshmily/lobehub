import { expect, it, vi } from 'vitest';

import { InMemoryStreamEventManager } from '../InMemoryStreamEventManager';

it('replays a terminal event that completed before the website SSE subscription', async () => {
  const manager = new InMemoryStreamEventManager();
  await manager.publishAgentRuntimeEnd({
    finalState: { status: 'completed' },
    operationId: 'operation-1',
    reason: 'completed',
    stepIndex: 1,
  });
  const onEvents = vi.fn();

  await manager.subscribeStreamEvents('operation-1', '0', onEvents);

  expect(onEvents).toHaveBeenCalledTimes(1);
  expect(onEvents.mock.calls[0][0][0].type).toBe('agent_runtime_end');
});

it('never publishes the trusted generation limit in an initial runtime event', async () => {
  const manager = new InMemoryStreamEventManager();
  await manager.publishAgentRuntimeInit('operation-1', {
    metadata: {
      platformManagedExecutionAuthorized: true,
      platformManagedMaxCredits: 4321,
      topicId: 'topic-1',
    },
    status: 'running',
  });

  const events = await manager.getStreamHistory('operation-1');

  expect(events[0]?.data).toEqual({ metadata: { topicId: 'topic-1' }, status: 'running' });
  expect(JSON.stringify(events)).not.toContain('4321');
  expect(JSON.stringify(events)).not.toContain('platformManagedExecutionAuthorized');
});
