import { describe, expect, it, vi } from 'vitest';

import { createGroupActionMemberBridgeHook } from './threadRunHooks';

describe('createGroupActionMemberBridgeHook', () => {
  it('keeps the reply target in both local and webhook completion transports', async () => {
    const completeGroupActionMember = vi.fn().mockResolvedValue(true);
    const hook = createGroupActionMemberBridgeHook(
      { completeGroupActionMember } as any,
      {
        anchorMessageId: 'review-anchor',
        expectedMembers: 1,
        groupToolMessageId: 'group-tool-message',
        mode: 'in_group',
        onComplete: 'resume',
        parentOperationId: 'supervisor-operation',
        replyToMessageId: 'author-message',
        threadId: 'review-thread',
      },
    );

    expect(hook.webhook?.body).toMatchObject({ replyToMessageId: 'author-message' });

    await hook.handler?.({
      finalState: { messages: [] },
      operationId: 'review-operation',
      reason: 'done',
    } as any);

    expect(completeGroupActionMember).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'review-operation',
        replyToMessageId: 'author-message',
      }),
    );
  });
});
