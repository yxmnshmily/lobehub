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

  /* 手机端：去边框线与圆角（按服务端设备变体条件应用，桌面不受影响）。 */
  innerContainerMobile: css`
    border: none;
    border-radius: 0;
  `,

  /* 设置页：内层容器承担纵向滚动。原生滚动条保留，外观由注入的
     CONTENT_SCROLL_CSS 统一（8px 圆角灰条）——这里不再隐藏，否则桌面端
     会变成"无滚动条盲滚"。 */
  innerContainerScroll: css`
    overflow: auto;
  `,

  // Outer container
  outerContainer: css`
    position: relative;

    overflow: hidden;

    padding-block: var(--container-padding-top, 8px);

    /* 2026-09-18：左侧保留 8px 留白（侧栏与内容之间），窗口右缘贴边 0
       （用户要求：右缘不加边距，内容与侧栏左右对齐排布）。 */
    padding-inline-start: var(--container-padding-left, 8px);

    background: ${isDesktop ? 'transparent' : cssVar.colorBgLayout};
  `,

  /* 手机端：去掉左右留白（按 UA 设备口径条件应用，桌面不受影响）。 */
  outerContainerMobile: css`
    padding-inline: 0;
  `,
}));
