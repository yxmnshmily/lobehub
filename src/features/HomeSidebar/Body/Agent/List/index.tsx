'use client';

import { memo } from 'react';

import type { MyTravelGroupReadiness } from '@/services/home';
import { useHomeStore } from '@/store/home';

import AllAgentsDrawer from '../AllAgentsDrawer';
import AgentListContent from './AgentListContent';

// The Home sidebar owns the all-agents drawer; other surfaces should import AgentListContent directly.
interface AgentListProps {
  error?: unknown;
  onMoreClick?: () => void;
  onRetry?: () => void;
  travelGroupStatus?: MyTravelGroupReadiness['status'];
}

const AgentList = memo<AgentListProps>(({ error, onMoreClick, onRetry, travelGroupStatus }) => {
  const [allAgentsDrawerOpen, closeAllAgentsDrawer] = useHomeStore((s) => [
    s.allAgentsDrawerOpen,
    s.closeAllAgentsDrawer,
  ]);

  return (
    <>
      <AgentListContent
        error={error}
        travelGroupStatus={travelGroupStatus}
        onMoreClick={onMoreClick}
        onRetry={onRetry}
      />
      <AllAgentsDrawer open={allAgentsDrawerOpen} onClose={closeAllAgentsDrawer} />
    </>
  );
});

export default AgentList;
