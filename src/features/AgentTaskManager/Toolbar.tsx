import { Flexbox, Popover } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { Clock3Icon, PanelRightCloseIcon, PlusIcon } from 'lucide-react';
import { memo, use, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { conversationSelectors, useConversationStore } from '@/features/Conversation';
import NavHeader from '@/features/NavHeader';
import TopicItem from '@/features/PageEditor/Copilot/TopicSelector/TopicItem';
import { GroupWorkConversationContext } from '@/features/SuperGroup/GroupWorkScope';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { useGlobalStore } from '@/store/global';

const Toolbar = memo(() => {
  const { t } = useTranslation('topic');
  const [topicPopoverOpen, setTopicPopoverOpen] = useState(false);
  const agentId = useConversationStore(conversationSelectors.agentId);
  const groupConversation = use(GroupWorkConversationContext);

  useChatStore((s) => s.useFetchTopics)(
    true,
    groupConversation ? { groupId: groupConversation.groupId } : { agentId },
  );

  const [activeTopicId, switchTopic, topics] = useChatStore((s) => [
    groupConversation ? groupConversation.topicId : s.activeTopicId,
    groupConversation ? groupConversation.onTopicChange : s.switchTopic,
    groupConversation
      ? s.topicDataMap[topicMapKey({ groupId: groupConversation.groupId })]?.items
      : topicSelectors.currentTopics(s),
  ]);
  const currentTopic = topics?.find((topic) => topic.id === activeTopicId);

  const toggleTaskAgentPanel = useGlobalStore((s) => s.toggleTaskAgentPanel);

  const isLoadingTopics = topics === undefined;
  const topicTitle = currentTopic?.title || t('title');
  const hasTopics = !!topics && topics.length > 0;

  const handleCreate = () => {
    if (groupConversation) groupConversation.onTopicChange(null);
    else void useChatStore.getState().switchTopic(null, { scope: 'task' });
  };

  return (
    <NavHeader
      showTogglePanelButton={false}
      left={
        <Text
          style={{ fontSize: 13, fontWeight: 500, marginLeft: 8 }}
          type={'secondary'}
          ellipsis={{
            tooltipWhenOverflow: true,
          }}
        >
          {topicTitle}
        </Text>
      }
      right={
        <>
          <ActionIcon
            icon={PlusIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('actions.addNewTopic')}
            onClick={handleCreate}
          />
          <Popover
            open={isLoadingTopics ? false : topicPopoverOpen}
            placement="bottomRight"
            trigger="click"
            content={
              hasTopics ? (
                <Flexbox
                  gap={4}
                  padding={8}
                  style={{
                    maxHeight: '50vh',
                    overflowY: 'auto',
                    width: '100%',
                  }}
                >
                  {topics!.map((topic) => (
                    <TopicItem
                      active={topic.id === activeTopicId}
                      key={topic.id}
                      topicId={topic.id}
                      topicTitle={topic.title}
                      onClose={() => setTopicPopoverOpen(false)}
                      onTopicChange={(id) => switchTopic(id)}
                    />
                  ))}
                </Flexbox>
              ) : (
                <Flexbox padding={16}>
                  <Text type={'secondary'}>{t('temp')}</Text>
                </Flexbox>
              )
            }
            styles={{
              content: {
                padding: 0,
                width: 240,
              },
            }}
            onOpenChange={setTopicPopoverOpen}
          >
            <ActionIcon
              disabled={isLoadingTopics}
              icon={Clock3Icon}
              loading={isLoadingTopics}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            />
          </Popover>
          <ActionIcon
            icon={PanelRightCloseIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            onClick={() => toggleTaskAgentPanel()}
          />
        </>
      }
    />
  );
});

Toolbar.displayName = 'Toolbar';

export default Toolbar;
