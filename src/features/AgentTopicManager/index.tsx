'use client';

import {
  getTopicWorkingDirectorySourcePath,
  groupTopicsByProject,
  groupTopicsByUpdatedTime,
} from '@lobechat/utils/client/topic';
import { Flexbox } from '@lobehub/ui';
import { memo, type ReactNode, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import TopicsSkeleton from '@/components/Skeleton/Topics';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { shinyTextStyles } from '@/styles/loading';
import type { ChatTopic } from '@/types/topic';

import BulkActionBar from './BulkActionBar';
import EmptyState from './EmptyState';
import Header from './Header';
import { useTopicsViewStore } from './store';
import Toolbar from './Toolbar';
import TopicGrid from './TopicGrid';
import TopicListView from './TopicListView';
import type { TopicManagementActions } from './types';
import {
  buildBotChannelOptions,
  getProjectFilterLabel,
  matchesBotChannel,
  matchesGroup,
  matchesStatus,
  matchesTimeRange,
  matchesTrigger,
  sortTopics,
} from './utils';

// Start small so users see infinite scroll kick in; each scroll-to-bottom
// triggers `loadMoreTopics` which appends another page into `topicDataMap`.
const PAGE_SIZE = 30;

/** Optional group adapter: the page stays shared, while access and navigation stay with its host. */
export interface TopicPageSource {
  error?: unknown;
  getArchiveTopics?: () => Promise<ChatTopic[]>;
  hasMore: boolean;
  header: ReactNode;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  loadMoreError?: unknown;
  management?: TopicManagementActions;
  onOpen: (topicId?: string) => void;
  retry: () => void;
  scopeKey: string;
  topics: ChatTopic[];
}

const AgentTopicManager = memo(({ source }: { source?: TopicPageSource }) => {
  const { t } = useTranslation('topic');
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const scopeKey = source?.scopeKey ?? activeAgentId;
  const sourceBacked = !!source;
  // Use the management page's dedicated SWR pipeline so the heavier
  // `withDetails` fetch doesn't share a bucket with the sidebar's cheap
  // fetch (the shared bucket let whichever response landed last clobber the
  // other).
  const useFetchAgentTopicsView = useChatStore((s) => s.useFetchAgentTopicsView);
  const useSearchTopics = useChatStore((s) => s.useSearchTopics);
  const loadMoreAgentTopicsView = useChatStore((s) => s.loadMoreAgentTopicsView);

  // Read directly from the view's topic map so `loadMore` appends are visible
  // here without waiting for SWR revalidation.
  const agentTopics = useChatStore(topicSelectors.agentTopicsViewTopics);
  const allTopics = source?.topics ?? agentTopics;
  const agentHasMore = useChatStore(topicSelectors.agentTopicsViewHasMore);
  const hasMore = source?.hasMore ?? agentHasMore;
  const agentLoadingMore = useChatStore(topicSelectors.agentTopicsViewIsLoadingMore);
  const isLoadingMore = source?.isLoadingMore ?? agentLoadingMore;
  const agentLoadMoreError = useChatStore(topicSelectors.agentTopicsViewLoadMoreError);
  const loadMoreError = source ? source.loadMoreError : agentLoadMoreError;
  const loadMore = source?.loadMore ?? loadMoreAgentTopicsView;

  const reset = useTopicsViewStore((s) => s.reset);
  const search = useTopicsViewStore((s) => s.search);
  const status = useTopicsViewStore((s) => s.status);
  const groupIds = useTopicsViewStore((s) => s.groupIds);
  const triggers = useTopicsViewStore((s) => s.triggers);
  const botChannels = useTopicsViewStore((s) => s.botChannels);
  const timeRange = useTopicsViewStore((s) => s.timeRange);
  const sortBy = useTopicsViewStore((s) => s.sortBy);
  const groupBy = useTopicsViewStore((s) => s.groupBy);
  const viewMode = useTopicsViewStore((s) => s.viewMode);
  const setStatus = useTopicsViewStore((s) => s.setStatus);
  const setGroupIds = useTopicsViewStore((s) => s.setGroupIds);
  const setTriggers = useTopicsViewStore((s) => s.setTriggers);
  const setBotChannels = useTopicsViewStore((s) => s.setBotChannels);
  const setTimeRange = useTopicsViewStore((s) => s.setTimeRange);
  const setSearch = useTopicsViewStore((s) => s.setSearch);

  // Reset whenever the agent context switches AND on unmount. The route
  // `/agent/:aid/topics` reuses the same component instance across agent
  // navigations, so an unmount-only cleanup would let `selectedIds` (and
  // other view state) from the previous agent persist into the next one —
  // which would mean a bulk Delete/Archive/Favorite click silently targets
  // stale IDs from another agent.
  useEffect(() => {
    reset();
    if (sourceBacked) setTriggers([]);
    return reset;
  }, [scopeKey, reset, setTriggers, sourceBacked]);

  const agentQuery = useFetchAgentTopicsView(!source, {
    agentId: activeAgentId,
    pageSize: PAGE_SIZE,
    // Opt into the heavier card-detail columns (firstUserMessage,
    // messageCount, cost, tokenUsage, description, trigger). Sidebar paths
    // omit this so their query stays cheap.
    withDetails: true,
  });

  const error = source ? source.error : agentQuery.error;
  const isLoading = source?.isLoading ?? agentQuery.isLoading;
  const mutate = source?.retry ?? agentQuery.mutate;
  const trimmedSearch = search.trim();
  const { data: searchResults } = useSearchTopics(
    !source && trimmedSearch.length > 0 ? trimmedSearch : undefined,
    { agentId: activeAgentId },
  );

  const baseTopics: ChatTopic[] = useMemo(() => {
    if (!source && trimmedSearch.length > 0) return searchResults ?? [];
    return allTopics ?? [];
  }, [source, trimmedSearch, searchResults, allTopics]);

  // Pool with every filter EXCEPT status applied. Reused for the final
  // filtered list AND for the per-status count badges so each tab shows
  // "what you'd see if you switched here with the same other filters".
  const preStatusPool = useMemo(
    () =>
      baseTopics.filter(
        (t) =>
          matchesGroup(t, groupIds) &&
          matchesTrigger(t, triggers) &&
          matchesTimeRange(t, timeRange) &&
          matchesBotChannel(t, botChannels),
      ),
    [baseTopics, groupIds, triggers, timeRange, botChannels],
  );

  const filtered = useMemo(() => {
    const out = preStatusPool.filter((t) => matchesStatus(t, status));
    return sortTopics(out, sortBy);
  }, [preStatusPool, status, sortBy]);

  const statusCounts = useMemo(
    () => ({
      active: preStatusPool.filter((t) => matchesStatus(t, 'active')).length,
      all: preStatusPool.length,
      // 'archived' has no visible tab today, but StatusFilter still includes it
      // — count it so the Record satisfies the type for any future tab.
      archived: preStatusPool.filter((t) => matchesStatus(t, 'archived')).length,
      completed: preStatusPool.filter((t) => matchesStatus(t, 'completed')).length,
      running: preStatusPool.filter((t) => matchesStatus(t, 'running')).length,
    }),
    [preStatusPool],
  );

  // Search results are flat — grouping by time confuses the relevance order
  // returned by the BM25 keyword search.
  const isSearchMode = trimmedSearch.length > 0 && !source;
  const useGroups = groupBy !== 'none' && !isSearchMode;

  const renderGroups = useMemo(() => {
    if (!useGroups) return [{ children: filtered, id: 'all' }];
    if (
      groupBy === 'byProject' &&
      filtered.some((topic) => topic.businessAssociations !== undefined)
    ) {
      const buckets = new Map<string, { id: string; title: string; children: ChatTopic[] }>();
      for (const topic of filtered) {
        // Keep one row per topic even when multiple objects are linked.
        const relations = topic.businessAssociations ?? [];
        const id = relations.length
          ? relations
              .map((item) => `${item.kind}:${item.id}`)
              .sort()
              .join('|')
          : 'unlinked';
        const title = relations.length
          ? relations
              .map((item) => `${t(`management.association.${item.kind}`)}：${item.title}`)
              .join('；')
          : t('management.association.none');
        const bucket = buckets.get(id) ?? { id, title, children: [] };
        bucket.children.push(topic);
        buckets.set(id, bucket);
      }
      return [...buckets.values()];
    }
    if (groupBy === 'byProject') {
      const field: 'createdAt' | 'updatedAt' = sortBy === 'createdAt' ? 'createdAt' : 'updatedAt';
      return groupTopicsByProject(filtered, field);
    }
    return groupTopicsByUpdatedTime(filtered);
  }, [filtered, useGroups, groupBy, sortBy, t]);

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const topic of baseTopics) {
      if (topic.businessAssociations !== undefined) {
        if (!topic.businessAssociations.length)
          map.set('unlinked', t('management.association.none'));
        for (const item of topic.businessAssociations)
          map.set(
            `${item.kind}:${item.id}`,
            `${t(`management.association.${item.kind}`)}：${item.title}`,
          );
        continue;
      }
      const wd = getTopicWorkingDirectorySourcePath(topic);
      if (wd && !map.has(wd)) {
        map.set(wd, getProjectFilterLabel(topic) ?? wd);
      }
    }
    return Array.from(map, ([value, label]) => ({ label, value }));
  }, [baseTopics, t]);

  const botChannelOptions = useMemo(() => buildBotChannelOptions(baseTopics), [baseTopics]);

  const totalAfterFilter = filtered.length;
  // 'active' is the default tab, so it doesn't count as a user-applied filter
  const hasActiveFilters =
    (status !== 'active' && status !== 'all') ||
    groupIds.length > 0 ||
    triggers.length > 0 ||
    botChannels.length > 0 ||
    timeRange !== 'all' ||
    trimmedSearch.length > 0;

  const clearFilters = () => {
    // "Clear filters" jumps to All so users can confirm there really is no
    // matching topic in the entire dataset; the default Active landing is
    // only for first visits.
    setStatus('all');
    setGroupIds([]);
    setTriggers([]);
    setBotChannels([]);
    setTimeRange('all');
    setSearch('');
  };

  // Infinite scroll — observe a sentinel near the end of the list. We pass
  // the scroll container as the IntersectionObserver `root` so detection is
  // tied to the in-page scroll position, not the window viewport (otherwise
  // a tall window can leave the sentinel "always intersecting" or never
  // intersecting, depending on layout).
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isSearchMode) return;
    const root = scrollContainerRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isLoadingMore && !loadMoreError) {
          void loadMore();
        }
      },
      { root, rootMargin: '300px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, isLoadingMore, isSearchMode, loadMore, loadMoreError]);

  if (!scopeKey) return <TopicsSkeleton />;

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <Header agentId={activeAgentId} breadcrumb={source?.header} />
      <div
        ref={scrollContainerRef}
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          minWidth: 0,
          overflowY: 'auto',
          padding: '20px 16px',
        }}
      >
        <Flexbox
          gap={16}
          style={{
            width: '100%',
          }}
        >
          <Toolbar
            botChannelOptions={botChannelOptions}
            getArchiveTopics={source?.getArchiveTopics}
            management={source?.management}
            projects={projects}
            readOnly={!!source && !source.management}
            statusCounts={statusCounts}
          />
          {(!source || source.management) && (
            <BulkActionBar
              management={source?.management}
              visibleIds={filtered.map((topic) => topic.id)}
              scopeKey={JSON.stringify([
                scopeKey,
                search,
                status,
                groupIds,
                triggers,
                botChannels,
                timeRange,
              ])}
            />
          )}
          {!isSearchMode && error && !isLoading && baseTopics.length === 0 ? (
            <AsyncError
              error={error}
              variant={'block'}
              onRetry={() => {
                void mutate();
              }}
            />
          ) : isLoading && baseTopics.length === 0 ? (
            <TopicsSkeleton chrome={'body'} />
          ) : totalAfterFilter === 0 ? (
            <EmptyState
              agentId={activeAgentId}
              hasFilters={hasActiveFilters}
              onClearFilters={clearFilters}
              onStart={source ? () => source.onOpen() : undefined}
            />
          ) : (
            <>
              {viewMode === 'card' ? (
                <TopicGrid
                  agentId={activeAgentId}
                  groupBy={groupBy}
                  groups={renderGroups}
                  readOnly={!!source && !source.management}
                  showGroupTitles={useGroups}
                  onOpen={source?.onOpen}
                />
              ) : (
                <TopicListView
                  agentId={activeAgentId}
                  groupBy={groupBy}
                  groups={renderGroups}
                  readOnly={!!source && !source.management}
                  showGroupTitles={useGroups}
                  onOpen={source?.onOpen}
                />
              )}
            </>
          )}
          {!isSearchMode && !isLoading && !error && hasMore && (
            <div aria-hidden ref={sentinelRef} style={{ height: 1 }} />
          )}
          {!isSearchMode && isLoadingMore && (
            <Flexbox align={'center'} paddingBlock={12}>
              <span className={shinyTextStyles.shinyText} style={{ fontSize: 12 }}>
                {t('management.loadingMore')}
              </span>
            </Flexbox>
          )}
          {!isSearchMode && Boolean(loadMoreError) && !isLoadingMore && (
            <Flexbox align={'center'} paddingBlock={12}>
              <AsyncError
                error={loadMoreError}
                variant={'inline'}
                onRetry={() => {
                  void loadMore();
                }}
              />
            </Flexbox>
          )}
        </Flexbox>
      </div>
    </Flexbox>
  );
});

AgentTopicManager.displayName = 'AgentTopicManager';

export default AgentTopicManager;
