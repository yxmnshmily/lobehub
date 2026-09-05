'use client';

import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import type { MyTravelGroupReadiness } from '@/services/home';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { SessionDefaultGroup } from '@/types/index';

import { resolveAgentListContentState } from './agentListContentState';
import Group from './Group';
import InboxItem from './InboxItem';
import SessionList from './List';
import { useAgentList } from './useAgentList';

interface AgentListContentProps {
  error?: unknown;
  hideInbox?: boolean;
  onMoreClick?: () => void;
  onRetry?: () => void;
  travelGroupStatus?: MyTravelGroupReadiness['status'];
}

// Keep this drawer-free so compact switchers can reuse the list without
// coupling to Home drawer state. Renders only workspace-public content;
// private items live in the sibling `Private` accordion section so
// workspace-shared and personal agents stay visually distinct.
//
// SWR subscription is owned by the enclosing accordion (Body/Agent/index.tsx)
// or by a standalone caller (e.g. SwitchPanel). Subscribing here too would
// re-fetch the list every time the accordion is expanded, animating the
// spinner on both Public and Private headers for no good reason.
const AgentListContent = memo<AgentListContentProps>(
  ({ error, hideInbox, onMoreClick, onRetry, travelGroupStatus }) => {
    const { t } = useTranslation('common');
    const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
    const authLoaded = useUserStore(authSelectors.isLoaded);
    const isLogin = useUserStore(authSelectors.isLogin);
    const contentState = resolveAgentListContentState({
      authLoaded: !!authLoaded,
      hasError: !!error,
      isInit,
      isLogin: !!isLogin,
    });
    const { customList, pinnedList, defaultList } = useAgentList();
    const inboxFallbackTitle =
      travelGroupStatus && travelGroupStatus !== 'ready'
        ? t('defaultSession')
        : '旅游群主AI';

  // Memoize computed visibility flags to prevent unnecessary recalculations
    const { showPinned, showCustom } = useMemo(() => {
      const hasPinned = Boolean(pinnedList?.length);
      const hasCustom = Boolean(customList?.length);

      return {
        showCustom: hasCustom,
        showPinned: hasPinned,
      };
    }, [pinnedList?.length, customList?.length]);

    if (contentState !== 'ready')
      return (
        <>
          {!hideInbox && <InboxItem fallbackTitle={inboxFallbackTitle} style={{ minHeight: 36 }} />}
          {contentState === 'error' && (
            <AsyncError error={error} variant="inline" onRetry={onRetry} />
          )}
          {contentState === 'loading' && <SkeletonList rows={3} />}
        </>
      );

  // Always render the default SessionList so the "+ Create Agent" entry is visible
  // even when the user has only the built-in Lobe AI inbox.
    return (
      <>
        {!hideInbox && <InboxItem fallbackTitle={inboxFallbackTitle} style={{ minHeight: 36 }} />}
        {showPinned && <SessionList dataSource={pinnedList!} />}
        {showCustom && <Group dataSource={customList!} />}
        <SessionList
          dataSource={defaultList ?? []}
          groupId={SessionDefaultGroup.Default}
          onMoreClick={onMoreClick}
        />
      </>
    );
  },
);

AgentListContent.displayName = 'AgentListContent';

export default AgentListContent;
