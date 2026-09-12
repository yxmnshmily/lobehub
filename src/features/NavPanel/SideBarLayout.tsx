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
