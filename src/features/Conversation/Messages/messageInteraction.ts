import type { UIChatMessage } from '@lobechat/types';

import { isLocalOnlyMessage } from '@/store/chat/utils/localMessages';

export const getMessageInteractionState = (
  message: UIChatMessage | undefined,
  disableEditing?: boolean,
  readOnly?: boolean,
) => {
  const isLocalOnly = isLocalOnlyMessage(message);

  return {
    effectiveDisableEditing: Boolean(disableEditing || readOnly || isLocalOnly),
    shouldSuppressContextMenu: Boolean(readOnly || isLocalOnly),
  };
};
