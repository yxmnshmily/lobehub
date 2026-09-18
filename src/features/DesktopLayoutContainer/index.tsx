import { Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { type FC, type PropsWithChildren } from 'react';
import { useEffect, useMemo, useRef } from 'react';

import { useActiveNavKey } from '@/features/NavPanel/useActiveNavKey';
import { useIsDark } from '@/hooks/useIsDark';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { getInnerCssVariables, getOuterCssVariables } from './cssVariables';
import { LayoutContainerContext } from './LayoutContainerContext';
import { styles } from './style';

/* 设置内容区滚动条：与侧栏统一的"原生 + 统一外观"方案（用户定稿）——
   8px 圆角灰条、colorFillSecondary 色、贴面板右边线、透明轨道。
   用注入 <style> 而非 antd-style 类（类样式在 HMR/样式缓存下可能不生效）。 */
const CONTENT_SCROLL_CSS = `
[data-overlay-scroll] {
  scrollbar-color: var(--ant-color-fill-secondary, rgba(128, 128, 128, 0.45)) transparent;
  scrollbar-width: thin;
  /* 10px 含滚动条：滚动条占右侧 8px（gutter 恒定预留），右侧内边距只给
     2px，左右视觉边距恒定 10px；左侧 10px 由这里统一提供 */
  scrollbar-gutter: stable;
}
@media (width <= 767px) {
  /* 10px 含滚动条：左 10；右 = 2 内边距 + 8 滚动条（gutter）= 10。
     注意不能清零——站点壳的 16px 在卡片外面，卡片内没有任何填充，
     清零会让正文直接贴住卡片边（2026-09-18 实测回归）。 */
  [data-overlay-scroll] { padding-left: 10px; padding-right: 2px; padding-block-start: 16px; }
  /* SettingContainer 自带的横向填充在这一模式下交给外层统一提供 */
  [data-overlay-scroll] [data-scroll-page] { padding-inline: 0 !important; }
}
[data-overlay-scroll]::-webkit-scrollbar { width: 8px; height: 8px; }
[data-overlay-scroll]::-webkit-scrollbar-thumb {
  background: var(--ant-color-fill-secondary, rgba(128, 128, 128, 0.45));
  border-radius: 4px;
}
[data-overlay-scroll]::-webkit-scrollbar-track { background: transparent; }
`;

const DesktopLayoutContainer: FC<PropsWithChildren> = ({ children }) => {
  const innerContainerRef = useRef<HTMLDivElement>(null);
  const isDarkMode = useIsDark();
  const [expand] = useGlobalStore((s) => [systemStatusSelectors.showLeftPanel(s)]);
  const activeNavKey = useActiveNavKey();
  /* 个人设置与工作区设置都走统一原生滚动条外观 */
  const pageScroll = activeNavKey === 'settings' || activeNavKey === 'workspace-settings';

  const outerCssVariables = useMemo(() => getOuterCssVariables({ expand }), [expand]);

  const innerCssVariables = useMemo(
    () => getInnerCssVariables({ isDark: isDarkMode }),
    [isDarkMode],
  );

  // Toast viewport is portaled to body, so it can't inherit the container-scoped vars
  useEffect(() => {
    const vars: Record<string, string> = {
      '--toast-border-radius': innerCssVariables['--container-border-radius'],
      '--toast-viewport-offset-x': '24px',
      '--toast-viewport-offset-y': '24px',
    };
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
    return () => {
      for (const key of Object.keys(vars)) root.style.removeProperty(key);
    };
  }, [innerCssVariables]);

  /* 手机端改由 style.ts 内的视口媒体查询处理（≤767px）——CodeBuddy 预览的
     手机模拟不改 UA，UA 分档在预览里不生效（2026-09-18）。 */

  return (
    <Flexbox
      data-desktop-layout-gap=""
      height={'100%'}
      width={'100%'}
      className={cx(
        styles.outerContainer,
        /* 仅群聊主页手机端（≤767px）去 12px 沟槽；设置等其它页面保留 */
        activeNavKey === 'group' && styles.outerContainerMobileGroup,
      )}
      style={{
        ...outerCssVariables,
        /* 网页端左侧沟槽（侧栏↔内容）已由 TravelSiteNavigation 的注入样式
           锁定为 12px !important（E 值定稿）；这里不再做任何覆盖。 */
      }}
    >
      {pageScroll && <style dangerouslySetInnerHTML={{ __html: CONTENT_SCROLL_CSS }} />}
      <Flexbox
        data-overlay-scroll={pageScroll ? '' : undefined}
        height={'100%'}
        ref={innerContainerRef}
        style={innerCssVariables}
        width={'100%'}
        className={cx(
          styles.innerContainer,
          /* 设置页：内层容器承担纵向滚动，滚动条为统一外观的原生条
             （样式见上方 CONTENT_SCROLL_CSS 注入）。其它页面保持原样。 */
          pageScroll && styles.innerContainerScroll,
        )}
      >
        <LayoutContainerContext value={innerContainerRef}>{children}</LayoutContainerContext>
      </Flexbox>
    </Flexbox>
  );
};
export default DesktopLayoutContainer;
