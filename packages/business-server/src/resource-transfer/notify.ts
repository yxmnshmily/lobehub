import type { TransferResourceType } from '@lobechat/types';

import { notifyUser } from '@/server/services/notification';

/**
 * Member-to-member transfer lifecycle moments worth telling someone about:
 * - `requested` — a pending request was created; the recipient must act.
 * - `accepted` / `declined` — the recipient answered; the initiator hears the
 *   outcome. On accept, a previous owner different from the initiator (primary
 *   owner reassignment) additionally gets a courtesy notice.
 */
export interface NotifyResourceTransferParams {
  event: 'accepted' | 'declined' | 'requested';
  /** Null when the initiator account was deleted after the request was created. */
  initiatorId: string | null;
  previousOwnerId?: string | null;
  recipientId: string;
  requestId: string;
  resourceId: string;
  resourceType: TransferResourceType;
  workspaceId: string;
}

/** Optional integration hook for delivering transfer lifecycle notifications. */
export async function notifyResourceTransfer(params: NotifyResourceTransferParams): Promise<void> {
  const recipients = new Set<string>();
  if (params.event === 'requested') recipients.add(params.recipientId);
  else {
    if (params.initiatorId && params.initiatorId !== params.recipientId)
      recipients.add(params.initiatorId);
    if (
      params.event === 'accepted' &&
      params.previousOwnerId &&
      params.previousOwnerId !== params.recipientId
    )
      recipients.add(params.previousOwnerId);
  }
  await Promise.all(
    [...recipients].map((userId) =>
      notifyUser({
        userId,
        workspaceId: params.workspaceId,
        eventId: params.requestId,
        type: `resource_transfer_${params.event}`,
        content:
          params.event === 'requested'
            ? '有一项资源移交需要你确认，请在通知中心查看。'
            : params.event === 'accepted'
              ? '资源移交已被接受。'
              : '资源移交已被拒绝。',
        metadata: { transfer: { requestId: params.requestId } },
      }),
    ),
  );
}
