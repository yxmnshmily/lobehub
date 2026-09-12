'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { VList } from 'virtua';

import AsyncError from '@/components/AsyncError';
import AgentSelectionEmpty from '@/features/AgentSelectionEmpty';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import GroupItem from '../List/AgentGroupItem';
import AgentItem from '../List/AgentItem';
import { useKeepSidebarListed } from '../List/useAgentList';

interface ContentProps {
  onNavigate?: () => void;
  open: boolean;
  searchKeyword: string;
}

const Content = memo<ContentProps>(({ searchKeyword, onNavigate }) => {
  const { error, mutate } = useFetchAgentList();
  const initialized = useHomeStore(homeAgentListSelectors.isAgentListInit);
  // Use server-side search if there's a keyword
  const trimmedKeyword = searchKeyword.trim();
  const isSearching = trimmedKeyword.length > 0;

  // Search agents using homeStore
  const [closeAllAgentsDrawer, useSearchAgents] = useHomeStore((s) => [
    s.closeAllAgentsDrawer,
    s.useSearchAgents,
  ]);
  const { data: searchResults, isLoading: isSearchLoading } = useSearchAgents(
    isSearching ? trimmedKeyword : undefined,
  );

  // Get all agents from homeStore (ungrouped agents for default view)
  const allUngroupedAgents = useHomeStore(homeAgentListSelectors.ungroupedAgents, isEqual);

  // The drawer is sidebar overflow, so it honors the caller's "removed from
  // my sidebar" list like every sidebar section — items hidden there are
  // findable on the /agents View All page instead.
  const keep = useKeepSidebarListed();

  // Filter and display - searchResults already returns SidebarAgentItem[]
  const displayItems = keep(isSearching ? searchResults || [] : allUngroupedAgents);

  const count = displayItems.length;

  // Close on navigation because the Home layout stays mounted offscreen across route changes.
  const handleNavigate = onNavigate ?? closeAllAgentsDrawer;

  if (!isSearching && error)
    return <AsyncError error={error} variant="inline" onRetry={() => mutate()} />;

  // Show loading skeleton when searching
  if ((!isSearching && !initialized) || (isSearching && (isSearchLoading || !searchResults))) {
    return (
      <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
        <SkeletonList rows={5} />
      </Flexbox>
    );
  }

  // Show empty state when no agents
  if (count === 0) {
    return <AgentSelectionEmpty search={isSearching} />;
  }

  return (
    <VList
      bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
      style={{ height: '100%' }}
    >
      {displayItems.map((item) => (
        <Flexbox key={item.id} paddingBlock={1} paddingInline={4}>
          {item.type === 'group' ? (
            <GroupItem item={item} onNavigate={handleNavigate} />
          ) : (
            <AgentItem item={item} onNavigate={handleNavigate} />
          )}
        </Flexbox>
      ))}
    </VList>
  );
});

Content.displayName = 'AllAgentsDrawerContent';

export default Content;
