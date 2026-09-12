import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  // Content container
  contentContainer: css`
    /* 社区列表页的上下留白集中在这三个变量里。改这里即可，所有社区页签
       （成员 / MCP / 模型 / 服务商 / Skills / 首页）一起生效，不需要再去
       浏览器里逐个元素试。 */
    --community-list-padding-block-end: 24px;
    --community-list-padding-block-start: 16px;
    --community-list-page-padding-block-end: 24px;

    min-height: 100%;
  `,

  /*
   * 列表内容（卡片 + 分页）的上下留白由这一个元素承担，页脚跟在它后面。
   * 带 data-community-list-content 标记，方便在检查器里一眼认出改的是它。
   */
  contentWrapper: css`
    width: 100%;
    padding-block: var(--community-list-padding-block-start) var(--community-list-padding-block-end);
  `,

  // Main container
  mainContainer: css`
    overflow-y: auto;
  `,
}));
