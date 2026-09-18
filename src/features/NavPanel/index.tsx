'use client';

import { useResponsive } from 'antd-style';
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
  const { xl = true } = useResponsive();
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

  // 群聊页：<1200px（桌面展开侧栏不可用的区间）不渲染桌面图标导航条——
  // 手机/平板上它只是左侧一条空的深色列，还会把聊天内容挤出右缘；
  // 群组页有自己的成员侧栏/移动布局。≥1200px 桌面保持原样。
  if (activeNavKey === 'group' && (narrowViewport || !xl)) return null;

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
