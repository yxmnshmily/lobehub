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

    /* 2026-09-18 用户确认：圆角边框手机端也要保留——不做 ≤767px 去框处理，
       手机端卡片（左右 16px 内缩）同样带 16px 圆角与细边框。 */
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

  /* 仅群聊主页（navKey=group）手机端（≤767px 视口）：去掉左右与顶部留白，
     内容直接贴边。设置页等其它页面不套这个类——手机端保留 12px 沟槽
     （侧栏与内容卡片之间的呼吸间距）。 */
  outerContainerMobileGroup: css`
    @media (width <= 767px) {
      padding-block-start: 0;
      padding-inline: 0;
    }
  `,
}));
