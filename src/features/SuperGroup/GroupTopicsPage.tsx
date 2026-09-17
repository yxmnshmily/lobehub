'use client';

import { GROUP_CHAT_TOPIC_URL, GROUP_CHAT_URL } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { SWRConfig } from 'swr';

import AgentTopicManager from '@/features/AgentTopicManager';
import { useTopicsViewStore } from '@/features/AgentTopicManager/store';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { evictMessageCache } from '@/store/chat/utils/evictMessageCache';
import type { ChatTopic } from '@/types/topic';

import { useGroupWorkRequest } from './useGroupWorkRequest';

export default function GroupTopicsPage() {
  const { gid = '' } = useParams<{ gid: string }>();
  return <GroupTopics groupId={gid} key={gid} />;
}

/** Only the data/access adapter is group-specific; the whole topic page is reused. */
export function GroupTopics({ groupId }: { groupId: string }) {
  const router = useQueryRoute();
  const utils = lambdaQuery.useUtils();
  const groups = lambdaQuery.groupConversation.listGroups.useQuery(undefined, { retry: false });
  const search = useTopicsViewStore((s) => s.search);
  const [keywords, setKeywords] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setKeywords(search.trim().slice(0, 200)), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = lambdaQuery.groupConversation.listTopics.useInfiniteQuery(
    { groupId, keywords: keywords || undefined, limit: 50, order: 'latest' },
    { enabled: !!groupId, retry: false, getNextPageParam: (page) => page.nextCursor ?? undefined },
  );
  const onOpen = (topicId?: string) => {
    useGroupWorkRequest.setState({ request: null });
    router.push(topicId ? GROUP_CHAT_TOPIC_URL(groupId, topicId) : GROUP_CHAT_URL(groupId));
  };
  const isLoadMoreError = query.isFetchNextPageError;
  const canManage =
    (!query.isError || isLoadMoreError) &&
    !groups.isError &&
    groups.data?.some((group) => group.groupId === groupId && group.kind === 'owner');
  const refresh = async () => {
    await Promise.all([
      utils.groupConversation.listTopics.invalidate(),
      utils.groupConversation.listGroups.invalidate(),
    ]);
  };
  const update = async (id: string, value: Partial<ChatTopic>) => {
    if (!canManage) throw new Error('Read-only group');
    try {
      return await topicService.updateTopic(id, value);
    } finally {
      await refresh();
    }
  };
  return (
    <SWRConfig value={{ suspense: false }}>
      <AgentTopicManager
        source={{
          management: canManage
            ? {
                favoriteTopic: (id, favorite) => update(id, { favorite }),
                updateTopicStatus: ({ topicId, status }) => update(topicId, { status }),
                removeTopic: async (id, removeFiles) => {
                  if (!canManage) throw new Error('Read-only group');
                  try {
                    const result = await topicService.removeTopic(id, removeFiles);
                    useChatStore
                      .getState()
                      .internal_dispatchTopic({ type: 'deleteTopic', id, groupId, scope: 'group' });
                    await evictMessageCache(
                      (context) => context.topicId === id || context.groupId === groupId,
                    );
                    await utils.groupConversation.listTextMessages.invalidate({ groupId });
                    await utils.groupConversation.listPublishedAssistantMessages.invalidate({
                      groupId,
                    });
                    await utils.message.getMessages.invalidate({ groupId });
                    return result;
                  } finally {
                    await refresh();
                  }
                },
              }
            : undefined,
          getArchiveTopics: canManage
            ? async () => {
                const topics: ChatTopic[] = [];
                let cursor: { id: string; createdAt: Date } | undefined;
                do {
                  const page = await lambdaClient.groupConversation.listTopics.query({
                    groupId,
                    limit: 50,
                    order: 'oldest',
                    cursor,
                  });
                  topics.push(
                    ...page.items.map((topic) => ({
                      ...topic,
                      favorite: topic.favorite ?? undefined,
                      title: topic.title ?? '',
                      createdAt: new Date(topic.createdAt).getTime(),
                      updatedAt: new Date(topic.updatedAt ?? topic.createdAt).getTime(),
                    })),
                  );
                  cursor = page.nextCursor ?? undefined;
                } while (cursor);
                return topics;
              }
            : undefined,
          scopeKey: groupId,
          header: (
            <Flexbox gap={4} style={{ minWidth: 0 }}>
              <Flexbox horizontal align="center" gap={8}>
                <Button type="text" onClick={() => onOpen()}>
                  群主页
                </Button>
                <Text type="secondary">›</Text>
                <Text weight={500}>话题</Text>
              </Flexbox>
              {groups.isError && (
                <Flexbox horizontal align="center" gap={8} role="alert">
                  <Text fontSize={12} type="danger">
                    群权限加载失败
                  </Text>
                  <Button
                    aria-label="重试权限加载"
                    size="small"
                    type="text"
                    onClick={() => void groups.refetch()}
                  >
                    重试
                  </Button>
                </Flexbox>
              )}
            </Flexbox>
          ),
          topics:
            query.isError && !isLoadMoreError
              ? []
              : (query.data?.pages.flatMap((page) => page.items) ?? []).map((topic) => ({
                  id: topic.id,
                  title: topic.title ?? '',
                  createdAt: new Date(topic.createdAt).getTime(),
                  updatedAt: new Date(topic.updatedAt ?? topic.createdAt).getTime(),
                  businessAssociations: topic.businessAssociations ?? [],
                  cost: topic.cost,
                  status: topic.status,
                  trigger: topic.trigger,
                  favorite: topic.favorite ?? undefined,
                })),
          error: query.isError && !isLoadMoreError ? query.error : undefined,
          isLoading: query.isLoading,
          hasMore: !!query.hasNextPage,
          isLoadingMore: query.isFetchingNextPage,
          loadMore: () => {
            void query.fetchNextPage();
          },
          loadMoreError: isLoadMoreError ? query.error : undefined,
          retry: () => {
            void query.refetch();
          },
          onOpen,
        }}
      />
    </SWRConfig>
  );
}
