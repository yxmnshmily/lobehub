import type { OperationToolDispatchPolicy } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

/** Editor mentions are untrusted: resolve every target against current group membership. */
export function createGroupMentionPolicy(
  message: string,
  members: ReadonlyArray<{ id: string }>,
  supervisorId: string,
): OperationToolDispatchPolicy | undefined {
  const ids = [
    ...new Set(
      Array.from(
        message.matchAll(/<mention\s+(?:name="[^"<>]*"\s+)?id="([^"<>]+)"\s*\/>/g),
        (match) => match[1],
      ),
    ),
  ];
  if (ids.some((id) => id !== supervisorId && !members.some((member) => member.id === id))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'The mentioned assistant is not available in this group',
    });
  }
  const targets = ids.filter((id) => id !== supervisorId);
  if (!targets.length) return;
  return {
    cursor: 0,
    finishAfterSteps: true,
    steps: targets.map((agentId) => ({
      apiName: 'speak',
      arguments: JSON.stringify({ agentId, instruction: message, skipCallSupervisor: false }),
      identifier: 'lobe-group-management',
      toolName: 'lobe-group-management____speak',
    })),
    version: 1,
  };
}
