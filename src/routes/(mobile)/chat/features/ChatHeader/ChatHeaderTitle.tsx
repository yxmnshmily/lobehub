import { ChatHeader } from '@lobehub/ui/mobile';
import { cssVar } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePersonalInbox } from '@/features/AgentRoute/usePersonalInbox';
import { useFetchActiveTopicDetail } from '@/hooks/useFetchActiveTopicDetail';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';

const ChatHeaderTitle = memo(() => {
  const { t } = useTranslation(['chat', 'topic']);
  const toggleConfig = useGlobalStore((s) => s.toggleMobileTopic);
  const [topicCount, topic] = useChatStore((s) => [
    topicSelectors.currentTopicCount(s),
    topicSelectors.currentActiveTopic(s),
  ]);
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const activeId = useAgentStore((s) => s.activeAgentId);
  const personalInbox = usePersonalInbox(activeId);
  const title = useAgentStore(agentSelectors.currentAgentDisplayName);

  // Archived topics fall out of the sidebar list fetch — pull their detail by
  // id so the title doesn't degrade to the "new topic" placeholder.
  useFetchActiveTopicDetail();

  const displayTitle = personalInbox ? '历史聊天记录' : isInbox ? '旅游群主AI' : title;
  const topicLabel = t('title', { ns: 'topic' });
  const triggerStyle = {
    appearance: 'none',
    background: 'transparent',
    border: 0,
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    minHeight: 44,
    minWidth: 44,
    padding: 0,
  } as const;

  return (
    <ChatHeader.Title
      desc={
        <button
          aria-label={topicLabel}
          type={'button'}
          style={{
            ...triggerStyle,
            alignItems: 'center',
            display: 'flex',
            gap: 4,
          }}
          onClick={() => toggleConfig()}
        >
          <span
            style={{
              maxWidth: '60vw',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {topic?.title || t('title', { ns: 'topic' })}
          </span>
          <ChevronDown
            aria-hidden
            size={12}
            style={{
              background: cssVar.colorFillSecondary,
              borderRadius: '50%',
              color: cssVar.colorTextDescription,
              height: 14,
              width: 14,
            }}
          />
        </button>
      }
      title={
        <button
          aria-label={topicLabel}
          type={'button'}
          style={{
            ...triggerStyle,
            marginRight: '8px',
            maxWidth: '64vw',
            overflow: 'hidden',
            textAlign: 'start',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          onClick={() => toggleConfig()}
        >
          {displayTitle}
          {topicCount > 0 ? ` (${topicCount})` : ''}
        </button>
      }
    />
  );
});

export default ChatHeaderTitle;
