import { agentDisplayName } from '@lobechat/types';
import { INSERT_MENTION_COMMAND } from '@lobehub/editor';
import { type ItemType } from '@lobehub/ui';
import { Avatar } from '@lobehub/ui/base-ui';
import { AtSign } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';

import { useChatInputStore } from '../../store';
import { ChatInputAction } from '../components/ChatInputAction';

const Mention = memo(() => {
  const { t } = useTranslation('chat');
  const editor = useChatInputStore((s) => s.editor);
  const agents = useAgentGroupStore((s) =>
    s.activeGroupId ? s.groupMap[s.activeGroupId]?.agents : undefined,
  );
  const items: ItemType[] = useMemo(
    () =>
      (agents ?? []).map((agent) => ({
        icon: (
          <Avatar
            avatar={agent.avatar}
            background={agent.backgroundColor ?? undefined}
            shape="square"
            size={24}
          />
        ),
        key: agent.id,
        label: agentDisplayName(agent, agent.id),
        onClick: () => {
          editor?.focus();
          editor?.dispatchCommand(INSERT_MENTION_COMMAND, {
            label: agentDisplayName(agent, agent.id),
            metadata: { id: agent.id, type: 'member' },
          });
        },
      })),
    [agents, editor],
  );

  // Only show for group sessions
  if (!items.length) return null;

  return (
    <ChatInputAction
      icon={AtSign}
      title={t('mention.title')}
      dropdown={{
        maxHeight: 320,
        menu: { items },
        minWidth: 200,
      }}
    />
  );
});

export default Mention;
