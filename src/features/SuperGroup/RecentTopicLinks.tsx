'use client';

import { GROUP_CHAT_TOPIC_URL, GROUP_CHAT_URL } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Alert, Button, DropdownMenu, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ListFilter,
  MessageSquare,
  MoreHorizontal,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaQuery } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { useGlobalStore } from '@/store/global';

import { useGroupWorkRequest } from './useGroupWorkRequest';
import { canRetainTopicPage, useRecentTopicControls } from './useRecentTopicControls';

const SUPER_GROUP_TOPIC_PAGE_SIZE = 20;

const styles = createStaticStyles(({ css, cssVar }) => ({
  headerRow: css`
    width: 100%;
    min-width: 0;
    border-radius: ${cssVar.borderRadius};

    &:hover,
    &:focus-within,
    &:has([data-popup-open]) {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

export default function RecentTopicLinks({
  groupId,
  defaultExpanded = false,
  collapsible = true,
  onOpen,
  onSelectTopic,
  scrollWithinSection = true,
}: {
  groupId: string;
  defaultExpanded?: boolean;
  collapsible?: boolean;
  onOpen?: () => void;
  onSelectTopic?: (topicId: string, messageId?: string) => void;
  scrollWithinSection?: boolean;
}) {
  const { t } = useTranslation(['chat', 'topic', 'common']);
  const router = useQueryRoute();
  const { pathname } = useActiveLocation();
  const topicsPath = `${GROUP_CHAT_URL(groupId)}/topics`;
  const topicsActive = pathname === topicsPath || pathname.startsWith(`${topicsPath}/`);
  const query = lambdaQuery.groupConversation.listTopics.useQuery(
    { groupId, limit: SUPER_GROUP_TOPIC_PAGE_SIZE, recent: true },
    {
      gcTime: 0,
      refetchOnWindowFocus: true,
      refetchInterval: 5000,
      retry: false,
    },
  );
  const toggleMobileTopic = useGlobalStore((state) => state.toggleMobileTopic);
  const topicBucket = useChatStore((state) => state.topicDataMap[topicMapKey({ groupId })]);
  const { refetch } = query;
  const { expanded, oldestFirst, setExpanded, setOldestFirst, topics } = useRecentTopicControls(
    query.data?.items ?? [],
    defaultExpanded,
  );
  useEffect(() => {
    if (topicBucket) void refetch();
  }, [topicBucket, refetch]);

  if (query.isLoading) return <SkeletonList rows={3} />;
  if (query.isError && (!query.data || !canRetainTopicPage(query.error.data?.code)))
    return (
      <Alert
        action={<Button onClick={() => void query.refetch()}>{t('groupMembership.retry')}</Button>}
        title={t('superGroup.topicsError')}
        type="error"
      />
    );

  return (
    <Flexbox gap={2} style={{ minWidth: 0 }}>
      <Flexbox
        horizontal
        align="center"
        className={styles.headerRow}
        gap={4}
        padding={0}
        style={{ minWidth: 0 }}
      >
        <Button
          aria-haspopup={onOpen ? 'dialog' : undefined}
          aria-label={t('title', { ns: 'topic' })}
          className="group-nav-section-header"
          type="text"
          style={{
            flex: 1,
            justifyContent: 'flex-start',
            minWidth: 0,
            height: 'var(--group-nav-row-height, 44px)',
            paddingInline: 4,
            gap: 8,
            color: cssVar.colorTextSecondary,
            background: 'transparent',
          }}
          onClick={() => {
            if (onOpen) onOpen();
            else {
              router.push(`${GROUP_CHAT_URL(groupId)}/topics`);
              toggleMobileTopic(false);
            }
          }}
        >
          <span
            className="group-nav-section-icon"
            style={{ display: 'inline-flex', justifyContent: 'center', width: 28, flexShrink: 0 }}
          >
            <MessageSquare aria-hidden size={18} />
          </span>
          <span data-nav-label="">
            {t('title', { ns: 'topic' })} {topics.length}
          </span>
          <ArrowRight
            aria-hidden
            color={topicsActive ? cssVar.colorText : cssVar.colorTextQuaternary}
            data-nav-expanded-only=""
            size={16}
            style={{ marginInlineStart: 'auto', flexShrink: 0 }}
          />
        </Button>
        {collapsible && !onOpen && (
          <ActionIcon
            aria-expanded={expanded}
            aria-label={expanded ? '收起话题' : '展开话题'}
            data-nav-expanded-only=""
            icon={ChevronDown}
            size="small"
            style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
            onClick={() => setExpanded(!expanded)}
          />
        )}
        {collapsible && !onOpen && (
          <DropdownMenu
            items={[
              {
                key: 'recent',
                label: t('superGroup.newestTopics', { defaultValue: '最新话题在前' }),
                icon: !oldestFirst ? <Check size={16} /> : undefined,
                onClick: () => setOldestFirst(false),
              },
              {
                key: 'oldest',
                label: t('superGroup.oldestTopics', { defaultValue: '已加载话题从早到晚' }),
                icon: oldestFirst ? <Check size={16} /> : undefined,
                onClick: () => setOldestFirst(true),
              },
            ]}
          >
            <ActionIcon
              aria-label={t('filter.sort', { ns: 'topic' })}
              data-nav-expanded-only=""
              icon={ListFilter}
              size="small"
              title={t('filter.sort', { ns: 'topic' })}
            />
          </DropdownMenu>
        )}
        {collapsible && !onOpen && (
          <DropdownMenu
            items={[
              {
                key: 'refresh',
                label: t('refresh', { ns: 'common', defaultValue: '刷新' }),
                disabled: query.isFetching,
                onClick: () => void refetch(),
              },
            ]}
          >
            <ActionIcon
              aria-label={t('more', { ns: 'common' })}
              data-nav-expanded-only=""
              icon={MoreHorizontal}
              size="small"
              title={t('more', { ns: 'common' })}
            />
          </DropdownMenu>
        )}
      </Flexbox>
      {collapsible && expanded && topics.length === 0 && (
        <Text type="secondary">{t('superGroup.noTopics')}</Text>
      )}
      {collapsible && expanded && (
        <Flexbox
          data-nav-scroll=""
          data-group-topic-preview=""
          gap={2}
          style={{
            maxHeight: scrollWithinSection ? 'min(380px, 40dvh)' : undefined,
            overflowY: scrollWithinSection ? 'auto' : undefined,
            overflowX: 'hidden',
            overscrollBehavior: scrollWithinSection ? 'contain' : undefined,
            flexShrink: 0,
            scrollbarWidth: 'thin',
          }}
        >
          {topics.map((topic) => (
            <NavItem
              icon={MessageSquare}
              key={topic.id}
              title={topic.latestMessage || topic.title || t('superGroup.untitledTopic')}
              onClick={() => {
                useGroupWorkRequest.setState({ request: null });
                if (onSelectTopic) onSelectTopic(topic.id, topic.latestMessageId);
                else
                  router.replace(
                    `${GROUP_CHAT_TOPIC_URL(groupId, topic.id)}${topic.latestMessageId ? `#${encodeURIComponent(topic.latestMessageId)}` : ''}`,
                  );
                toggleMobileTopic(false);
              }}
            />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
}
