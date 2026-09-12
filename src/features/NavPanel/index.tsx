'use client';

import { memo, useSyncExternalStore } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';

import { NavPanelDraggable } from './components/NavPanelDraggable';
import {
  DEFAULT_NAV_SKELETON_SHAPE,
  NAV_SKELETON_SHAPES,
  NavSideBarSkeleton,
} from './components/SideBarSkeleton';
import { NAV_PANEL_RIGHT_DRAWER_ID } from './constants';
import { getNavPanelRegistrySnapshot, subscribeNavPanelRegistry } from './registry';
import { useActiveNavKey } from './useActiveNavKey';

const NavPanelFallback = memo<{ navKey: string }>(({ navKey }) => (
  <NavSideBarSkeleton {...(NAV_SKELETON_SHAPES[navKey] ?? DEFAULT_NAV_SKELETON_SHAPE)} />
));

const NavPanel = memo(() => {
  const activeNavKey = useActiveNavKey();
  const narrowViewport = useIsMobile();
  const getActiveContent = () => getNavPanelRegistrySnapshot().get(activeNavKey);
  const registeredContent = useSyncExternalStore(
    subscribeNavPanelRegistry,
    getActiveContent,
    getActiveContent,
  );
  if (registeredContent?.hidden) return null;
  const activeContent = registeredContent
    ? { key: activeNavKey, node: registeredContent.node }
    : { key: `pending:${activeNavKey}`, node: <NavPanelFallback navKey={activeNavKey} /> };

  // Compact group routes use their mobile history/member surfaces, with no desktop gutter.
  if (narrowViewport && activeNavKey === 'group') return null;

  return (
    <>
      <NavPanelDraggable activeContent={activeContent} navKey={activeNavKey} />
      <div
        id={NAV_PANEL_RIGHT_DRAWER_ID}
        style={{
          height: '100%',
          position: 'relative',
          width: 0,
          zIndex: 10,
        }}
      />
    </>
  );
});

NavPanel.displayName = 'NavPanel';

export { NavPanelPortal } from './NavPanelPortal';
export { useActiveNavKey } from './useActiveNavKey';
export default NavPanel;
