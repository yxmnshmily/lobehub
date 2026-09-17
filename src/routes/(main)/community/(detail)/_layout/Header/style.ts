import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Header container
  headerContainer: css`
    border-block-end: 0.5px solid var(--header-border-color, ${cssVar.colorBorderSecondary});

    /* 与列表页头部一致：导航行溢出时露出细滚动条供鼠标拖动。 */
    nav {
      scrollbar-color: ${cssVar.colorFillSecondary} transparent;
      scrollbar-width: thin;

      &::-webkit-scrollbar {
        height: 3px;
      }

      &::-webkit-scrollbar-thumb {
        border-radius: 2px;
        background: ${cssVar.colorFillSecondary};
      }
    }
  `,
}));
