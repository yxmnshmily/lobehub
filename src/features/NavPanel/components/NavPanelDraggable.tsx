'use client';

import { DraggablePanel } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx, useResponsive } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, Suspense, useMemo, useRef } from 'react';

import NavPanelUpgradeEntry from '@/business/client/features/NavPanelUpgradeEntry';
import { NavSideBarSkeleton } from '@/components/Skeleton/NavPanel/SideBar';
import { isDesktop } from '@/const/version';
import Footer from '@/features/HomeSidebar/Footer';
import { USER_DROPDOWN_ICON_ID } from '@/features/NavPanel/constants';
import { TOGGLE_BUTTON_ID } from '@/features/NavPanel/ToggleLeftPanelButton';
import { useGlobalStore } from '@/store/global';
import {
  NAV_PANEL_MAX_WIDTH,
  NAV_PANEL_MIN_WIDTH,
  systemStatusSelectors,
} from '@/store/global/selectors';
import { isMacOS } from '@/utils/platform';

import AccountHeader from '../AccountHeader';
import { useNavPanelSizeChangeHandler } from '../hooks/useNavPanel';
import { resolveNavPanelPresentation, supportsCompactNavRail } from '../presentation';
import { BACK_BUTTON_ID } from './BackButton';

const draggableStyles = createStaticStyles(({ css, cssVar }) => ({
  automaticCompact: css`
    #${TOGGLE_BUTTON_ID} {
      display: none !important;
    }
  `,
  compactAgent: css`
    [data-nav-header] > :first-child {
      flex-direction: column;
      gap: 4px;
    }

    [data-agent-switcher] {
      gap: 0;
      justify-content: center;
    }

    [data-agent-switcher] > :not(:first-child) {
      display: none;
    }
  `,
  expandedGroup: css`
    --group-nav-row-inset: 14px;

    [data-nav-header] {
      padding-inline: 10px !important;
    }

    [data-nav-footer-link] > * {
      gap: 8px;
      padding-inline: 10px !important;
    }

    [data-group-nav-branches] {
      padding-inline: 0;
    }

    [data-group-nav-branches] > *::before {
      inset-inline-start: -8px !important;
      width: 8px !important;
    }

    .group-nav-section-icon {
      display: inline-flex;
      flex-shrink: 0;
      justify-content: center;
      width: 28px;
    }

    [data-nav-footer-actions] {
      padding-inline: 12px !important;
    }

    [data-nav-footer-actions] button {
      width: 40px;
      min-width: 40px;
    }
  `,
  groupIcons: css`
    .group-nav-section-header {
      border-block-end: 0.5px dashed
        color-mix(in srgb, ${cssVar.colorBorderSecondary} 60%, transparent);
    }

    [data-nav-header] svg.lucide,
    .group-nav-section-icon svg,
    [data-nav-footer-link] svg.lucide,
    [data-nav-footer-actions] svg.lucide,
    [data-nav-item] svg.lucide:not([data-nav-chevron]) {
      flex-shrink: 0;

      width: 20px !important;
      height: 20px !important;

      color: ${cssVar.colorTextSecondary} !important;

      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.75;
    }
  `,
  compact: css`
    box-sizing: border-box;
    padding-block-start: ${isDesktop ? '0' : '8px'};

    [data-nav-header] {
      flex-direction: column;
      gap: 4px;
    }

    [data-nav-header] > * {
      flex: none;
    }

    [data-nav-breadcrumb] li:not(:first-child) {
      display: none;
    }

    [data-nav-header-actions] {
      flex-direction: column;
    }

    [data-nav-label],
    [data-nav-expanded-only] {
      display: none !important;
    }

    [data-nav-item] {
      justify-content: center;

      box-sizing: border-box;

      /* ActionIcon sets an inline pixel width; every rail row must share its center. */
      width: 100% !important;
      height: 44px;
      margin-inline: 0;
      padding-inline: 0;
    }

    [data-nav-scroll] {
      max-height: min(460px, 40dvh) !important;
    }

    [data-nav-section-title] {
      justify-content: center;
      min-width: 20px;
    }

    .group-nav-section-header {
      position: relative;
      height: 44px;
      min-height: 44px;
      padding-inline: 0;
    }

    .group-nav-section-icon {
      position: absolute;
      inset-block-start: 50%;
      inset-inline-start: calc(50% - 14px);
      transform: translateY(-50%);
    }

    .group-nav-section-indicator {
      position: absolute;
      inset-block-start: 50%;
      inset-inline-end: 0;
      transform: translateY(-50%);

      display: inline-flex;
    }

    [data-nav-footer-actions] {
      flex-direction: column;
      align-items: center;
      padding-inline: 0;
    }

    [data-nav-footer-actions] button {
      width: 44px;
      height: 44px;
    }

    [data-nav-footer-link] > * {
      justify-content: center;
      min-height: 44px;
      padding-inline: 0;
    }
    #${TOGGLE_BUTTON_ID} {
      width: 32px !important;
      opacity: 1 !important;
    }
  `,
  content: css`
    position: relative;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    height: 100%;
    min-height: 100%;
    max-height: 100%;
  `,
  mobile: css`
    overflow: hidden;
    display: flex;
    flex: 0 0 64px;
    flex-direction: column;

    width: 64px;
    min-width: 64px;
    height: 100%;

    #${TOGGLE_BUTTON_ID} {
      display: none !important;
    }
  `,
  inner: css`
    position: relative;

    overflow: hidden;
    flex: 1;

    min-width: 240px;
    max-width: 100%;
    min-height: 0;
  `,
  layer: css`
    position: absolute;
    inset: 0;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 240px;
    max-width: 100%;
    min-height: 100%;
    max-height: 100%;
  `,
  panel: css`
    user-select: none;
    height: 100%;
    color: ${cssVar.colorTextSecondary};
    background: ${isDesktop && isMacOS() ? 'transparent' : cssVar.colorBgLayout};

    * {
      user-select: none;
    }

    [data-nav-scroll] > *,
    [data-nav-scroll] [data-nav-item] {
      flex-shrink: 0;
    }

    #${TOGGLE_BUTTON_ID} {
      width: 32px !important;
      opacity: 1;
    }

    #${USER_DROPDOWN_ICON_ID} {
      width: 0 !important;
      opacity: 0;
      transition:
        opacity,
        width 0.2s ${cssVar.motionEaseOut};
    }
    #${BACK_BUTTON_ID} {
      width: 24px !important;
    }

    &:hover {
      #${USER_DROPDOWN_ICON_ID} {
        width: 14px !important;
        opacity: 1;
      }
    }
  `,
}));

interface NavPanelDraggableProps {
  activeContent: {
    key: string;
    node: ReactNode;
  };
  navKey: string;
}

const classNames = {
  content: draggableStyles.content,
};

// Mobile has no NavPanel portal host. Reuse the same content and icon-rail styles inline.
export const CompactNavPanel = memo(
  ({ children, expanded = false }: { children: ReactNode; expanded?: boolean }) => (
    <aside
      style={expanded ? { width: 'min(300px, 45vw)', minWidth: 0, flexShrink: 0 } : undefined}
      className={cx(
        draggableStyles.panel,
        draggableStyles.groupIcons,
        expanded && draggableStyles.expandedGroup,
        !expanded && draggableStyles.compact,
        !expanded && draggableStyles.mobile,
      )}
    >
      <Suspense fallback={null}>
        <AccountHeader compact={!expanded} />
      </Suspense>
      <div className={draggableStyles.content} style={{ flex: 1, minHeight: 0 }}>
        {children}
      </div>
      <Suspense fallback={null}>
        <Footer />
      </Suspense>
    </aside>
  ),
);

export const NavPanelDraggable = memo<NavPanelDraggableProps>(({ activeContent, navKey }) => {
  const [expand, togglePanel, isStatusInit, panelWidth] = useGlobalStore((s) => [
    systemStatusSelectors.showLeftPanel(s),
    s.toggleLeftPanel,
    systemStatusSelectors.isStatusInit(s),
    systemStatusSelectors.leftPanelWidth(s),
  ]);
  const handleSizeChange = useNavPanelSizeChangeHandler();
  const { xl } = useResponsive();
  const groupSidebar = ['home', 'group', 'tasks', 'data-center', 'apps'].includes(navKey);
  const iconSidebar = supportsCompactNavRail(navKey);
  // Keep the user's saved preference intact. A medium viewport only changes the
  // current presentation, and the full panel returns automatically when room does.
  const { automaticCompact, compact } = resolveNavPanelPresentation({
    supportsCompactRail: iconSidebar,
    userExpanded: expand ?? true,
    // 2026-09-17：断点从 lg(992) 提到 xl(1200)——iPad mini 横屏(1024)也要进入
    // 图标栏 + 弹出菜单模式；1200~1600 之间保持展开侧栏（可拖拽调宽）。
    viewportAllowsExpanded: xl,
  });

  // Defer DraggablePanel mount until system status hydrates; otherwise defaultSize
  // captures the pre-hydration default and the DOM drifts off NavigationBar's live width.
  const defaultWidthRef = useRef(0);
  if (defaultWidthRef.current === 0 && isStatusInit) {
    defaultWidthRef.current = systemStatusSelectors.leftPanelWidth(useGlobalStore.getState());
  }

  const styles = useMemo(
    () => ({
      background: isDesktop && isMacOS() ? 'transparent' : cssVar.colorBgLayout,
      zIndex: 11,
    }),
    [],
  );

  if (defaultWidthRef.current === 0) {
    const pendingWidth = systemStatusSelectors.leftPanelWidth(useGlobalStore.getState());
    return <div aria-hidden style={{ flexShrink: 0, height: '100%', width: pendingWidth }} />;
  }

  const defaultSize = { height: '100%', width: defaultWidthRef.current };

  return (
    <DraggablePanel
      classNames={classNames}
      defaultSize={defaultSize}
      expand={expand || compact}
      expandable={false}
      maxWidth={compact ? 64 : NAV_PANEL_MAX_WIDTH}
      minWidth={compact ? 64 : NAV_PANEL_MIN_WIDTH}
      placement="left"
      showBorder={false}
      size={iconSidebar ? { width: compact ? 64 : panelWidth, height: '100%' } : undefined}
      style={styles}
      className={cx(
        draggableStyles.panel,
        iconSidebar && draggableStyles.groupIcons,
        groupSidebar && !compact && draggableStyles.expandedGroup,
        compact && draggableStyles.compact,
        automaticCompact && draggableStyles.automaticCompact,
        compact && navKey === 'agent' && draggableStyles.compactAgent,
      )}
      onExpandChange={togglePanel}
      onSizeDragging={handleSizeChange}
    >
      <Suspense fallback={null}>
        <AccountHeader compact={compact} />
      </Suspense>
      <div className={draggableStyles.inner} style={compact ? { minWidth: 0 } : undefined}>
        <div
          className={draggableStyles.layer}
          key={activeContent.key}
          style={compact ? { minWidth: 0 } : undefined}
        >
          {/* The active route registers its sidebar content from an effect, so
              until that route's chunk lands there is nothing to render. A
              matching skeleton keeps the pane from popping in from empty. */}
          {activeContent.node ?? (compact ? null : <NavSideBarSkeleton />)}
        </div>
      </div>
      <Suspense fallback={null}>
        <NavPanelUpgradeEntry />
      </Suspense>
      <Suspense>
        <Footer />
      </Suspense>
    </DraggablePanel>
  );
});
