import { createStaticStyles } from 'antd-style';

import { isDesktop } from '@/const/version';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Inner container
  innerContainer: css`
    position: relative;

    overflow: hidden;

    /* Same frame as every sidebar (see SideBarLayout) — one source of truth
       for the app shell containers. */
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: var(--container-border-radius, 16px);
    border-end-end-radius: var(
      --container-border-bottom-right-radius,
      var(--container-border-radius, 16px)
    );

    background: ${cssVar.colorBgContainer};
  `,

  // Outer container
  outerContainer: css`
    position: relative;

    overflow: hidden;

    padding-block: var(--container-padding-top, 8px);

    /* 2026-09-17：按用户要求右侧贴边为 0，左侧保留留白（浏览器 12px / 桌面壳 8px）。
       只给 inline-start，右侧不撑开——内容直接贴窗口右缘。 */
    padding-inline-start: var(--container-padding-left, 8px);

    background: ${isDesktop ? 'transparent' : cssVar.colorBgLayout};
  `,
}));
