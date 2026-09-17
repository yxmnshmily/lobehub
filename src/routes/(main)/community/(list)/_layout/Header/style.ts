import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Header container
  headerContainer: css`
    border-block-end: 0.5px solid var(--header-border-color, ${cssVar.colorBorderSecondary});

    /* 导航行放不下全部 tab 时露出细滚动条：Nav 本身把滚动条隐藏了
       （scrollbar-width: none），鼠标用户既看不到也拖不动，后面的 tab
       会变成"点击不到"。这里只露出 3px 细条，不与页面主滚动条叠加。 */
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
