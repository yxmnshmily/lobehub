'use client';

import { Center, Grid, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { InboxIcon, ServerCrash } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';

import { ArticleSkeleton } from '@/components/Skeleton';
import { useClientDataSWR } from '@/libs/swr';
import { agentService, type AvailableAgentItem } from '@/services/agent';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import AgentItem from './AgentItem';
import { useDetailContext } from './DetailContext';
import { agentListStyles as styles } from './style';
import VirtuosoLoading from './VirtuosoLoading';

const PAGE_SIZE = 12;

const AgentList = memo(({ identifier, userId }: { identifier: string; userId?: string }) => {
  const { t } = useTranslation('plugin');

  // Local state for pagination
  const [items, setItems] = useState<AvailableAgentItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const prevPageRef = useRef(currentPage);

  // SWR fetch data (lazy loading - only requests when component mounts)
  const { data, isLoading, error } = useClientDataSWR(
    identifier && userId ? ['skillLocalAgents', userId, identifier, currentPage] : null,
    async () => {
      const offset = (currentPage - 1) * PAGE_SIZE;
      const agents = await agentService.queryAgents({
        pluginId: identifier,
        limit: PAGE_SIZE + 1,
        offset,
      });
      return { items: agents.slice(0, PAGE_SIZE), totalCount: offset + agents.length };
    },
  );

  // Data accumulation logic
  useEffect(() => {
    if (data) {
      if (currentPage === 1) {
        setItems(data.items);
      } else if (currentPage > prevPageRef.current) {
        setItems((prev) => [...prev, ...data.items]);
      }
      setTotalCount(data.totalCount);
      setIsInitialized(true);
      prevPageRef.current = currentPage;
    }
  }, [data, currentPage]);

  const hasMore = items.length < totalCount;

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      setCurrentPage((prev) => prev + 1);
    }
  }, [isLoading, hasMore]);

  // Initial loading state
  if (!isInitialized && isLoading) {
    return (
      <Grid gap={12} rows={2} width={'100%'}>
        {Array.from({ length: 4 }).map((_, index) => (
          <ArticleSkeleton avatar={40} key={index} rows={1} />
        ))}
      </Grid>
    );
  }

  // Error state
  if (error) {
    return (
      <Center gap={12} padding={40}>
        <Icon color={cssVar.colorTextDescription} icon={ServerCrash} size={80} />
        <Text type={'secondary'}>{t('skillDetail.networkError')}</Text>
      </Center>
    );
  }

  // Empty state
  if (isInitialized && items.length === 0) {
    return (
      <Center gap={12} padding={40}>
        <Icon color={cssVar.colorTextDescription} icon={InboxIcon} size={80} />
        <Text type={'secondary'}>{t('skillDetail.noAgents')}</Text>
      </Center>
    );
  }

  // Use VirtuosoGrid for rendering
  return (
    <VirtuosoGrid
      data={items}
      endReached={loadMore}
      increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
      itemClassName={styles.item}
      listClassName={styles.list}
      overscan={24}
      style={{ height: '50vh', width: '100%' }}
      components={{
        Footer: isLoading ? VirtuosoLoading : () => <div style={{ height: 16 }} />,
      }}
      itemContent={(_, item) => (
        <AgentItem
          agentId={item.id}
          avatar={item.avatar || undefined}
          backgroundColor={item.backgroundColor || undefined}
          description={item.description || undefined}
          identifier={item.id}
          key={item.id}
          title={item.name || item.title || item.id}
        />
      )}
    />
  );
});

const Agents = () => {
  const { identifier } = useDetailContext();
  const userId = useUserStore(userProfileSelectors.userId);
  return <AgentList identifier={identifier} key={`${userId}:${identifier}`} userId={userId} />;
};

export default Agents;
