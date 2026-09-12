import { ChatErrorType, type ChatMessageError } from '@lobechat/types';

import InsufficientCreditsCard from '../features/InsufficientCreditsCard';

interface BusinessChatErrorMessageExtraOptions {
  /**
   * Retry for the failed turn, resolved by the render surface. Business cards
   * must use it instead of deriving a retry from `messageId`: on the group
   * surface (a multi-step run) `messageId` is a nested content block, which the
   * message-level store actions cannot resolve.
   */
  onRetry?: () => void;
}

export default function useRenderBusinessChatErrorMessageExtra(
  error: ChatMessageError | null | undefined,
  _messageId: string,
  options?: BusinessChatErrorMessageExtraOptions,
) {
  if (!error) return null;
  const body = error.body;
  const messages = [error.message, body?.message, body?.error?.message].filter(
    (value): value is string => typeof value === 'string',
  );
  const groupOwner =
    String(error.type) === 'GROUP_OWNER_CREDITS_EMPTY' ||
    messages.some((value) => value.includes('[GROUP_OWNER_CREDITS_EMPTY]'));
  const localBalance =
    ['BALANCE_EMPTY', 'PLATFORM_CREDITS_EMPTY'].includes(String(error.type)) ||
    messages.some((value) => /\[(?:BALANCE_EMPTY|PLATFORM_CREDITS_EMPTY)\]/.test(value));
  const planLimit = new Set<string>([
    ChatErrorType.InsufficientBudgetForModel,
    ChatErrorType.FreePlanLimit,
    ChatErrorType.SubscriptionPlanLimit,
  ]).has(String(error.type));
  if (!groupOwner && !localBalance && !planLimit) return null;
  return (
    <InsufficientCreditsCard errorBody={body} groupOwner={groupOwner} onRetry={options?.onRetry} />
  );
}
