import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { ListRestart } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';

import { messageStateSelectors, useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

export const delAndRegenerateAction = defineAction({
  key: 'delAndRegenerate',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    const isRegenerating = useConversationStore(
      messageStateSelectors.isMessageRegenerating(ctx.id),
    );
    const delAndRegenerateMessage = useConversationStore((s) => s.delAndRegenerateMessage);
    const [groupId, scope, threadId] = useConversationStore((s) => [
      s.context.groupId,
      s.context.scope,
      s.context.threadId,
    ]);
    const keepHistory = useAgentGroupStore(
      (s) =>
        !!groupId &&
        (!scope || scope === 'group') &&
        !threadId &&
        s.groupMap[groupId]?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
    );

    return useMemo(
      () => ({
        disabled: isRegenerating,
        handleClick: () => delAndRegenerateMessage(ctx.id),
        icon: ListRestart,
        key: 'delAndRegenerate',
        label: t(
          keepHistory ? 'messageAction.regenerateKeepHistory' : 'messageAction.delAndRegenerate',
        ),
      }),
      [t, ctx.id, isRegenerating, delAndRegenerateMessage, keepHistory],
    );
  },
});
