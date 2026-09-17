import { Flexbox, ScrollShadow, TooltipGroup } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, Suspense } from 'react';

import { SideBarHeaderSkeleton } from '@/features/NavPanel/components/SideBarSkeleton';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';

/**
 * One surface for every sidebar.
 *
 * The settings pane already framed its navigation with a 1px token border and a
 * 16px radius; every other nav key (home, resource, project, workspace, pages,
 * agents, group, community) rendered the same navigation without it, so the
 * left column changed shape from route to route. Owning the frame here keeps a
 * single source of truth instead of one copy per sidebar.
 */

/* 侧栏滚动条样式：用注入的 <style> 而非 antd-style 类——类样式在 HMR/样式
   缓存下可能不生效（"反复不生效"的根因），原生 <style> 注入必定生效。 */
const SIDEBAR_SCROLL_CSS = `
[data-nav-layout] {
  scrollbar-color: var(--ant-color-fill-secondary, rgba(128, 128, 128, 0.45)) transparent;
  scrollbar-width: thin;
}
[data-nav-layout] ::-webkit-scrollbar { width: 8px; height: 8px; }
[data-nav-layout] ::-webkit-scrollbar-thumb {
  background: var(--ant-color-fill-secondary, rgba(128, 128, 128, 0.45));
  border-radius: 4px;
}
[data-nav-layout] ::-webkit-scrollbar-track { background: transparent; }
`;

const styles = createStaticStyles(({ css }) => ({
  surface: css`
    overflow: hidden;

    height: 100%;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
}));

interface SidebarLayoutProps {
  body?: ReactNode;
  header?: ReactNode;
}

const SideBarLayout = memo<SidebarLayoutProps>(({ header, body }) => {
  return (
    <div className={styles.surface}>
      <style dangerouslySetInnerHTML={{ __html: SIDEBAR_SCROLL_CSS }} />
      <Flexbox
        data-nav-layout=""
        gap={1}
        style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}
      >
        <Suspense fallback={<SideBarHeaderSkeleton />}>{header}</Suspense>
        <ScrollShadow size={2} style={{ flex: '1 1 0', minHeight: 0 }}>
          <TooltipGroup>
            <Suspense fallback={<SkeletonList paddingBlock={8} />}>{body}</Suspense>
          </TooltipGroup>
        </ScrollShadow>
      </Flexbox>
    </div>
  );
});

export default SideBarLayout;
