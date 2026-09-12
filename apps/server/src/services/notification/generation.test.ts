// @vitest-environment node
import { expect, it, vi } from 'vitest';

import { notifyGenerationFailed } from './generation';

const emit = vi.hoisted(() => vi.fn(async (_event: unknown) => {}));
vi.mock('./index', () => ({ notifyUser: emit }));

it.each(['image', 'video'] as const)(
  'links failed %s generation to the original topic and task identity',
  async (kind) => {
    await notifyGenerationFailed({
      kind,
      asyncTaskId: 'task',
      topicId: 'topic',
      userId: 'owner',
      workspaceId: 'ws',
    });
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: `${kind}_generation_failed`,
        eventId: 'task',
        userId: 'owner',
        workspaceId: 'ws',
        actionUrl: `/${kind}?topic=topic`,
      }),
    );
  },
);
