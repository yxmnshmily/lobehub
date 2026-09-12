import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Main container
  mainContainer: css`
    container: memory / inline-size;
    position: relative;
    overflow: hidden;
    background: ${cssVar.colorBgContainer};
  `,
  contentLayout: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  `,
  navigation: css`
    min-width: 0;
    padding: 8px 4px;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
  `,
  navigationRow: css`
    align-items: center;
    min-width: 0;

    > * {
      flex: none;
    }
  `,
  navigationTabs: css`
    overflow: auto hidden;
    flex: 1 !important;
    min-width: 0;

    > * {
      flex: none;
    }
  `,
  navigationSearch: css`
    flex: none;
  `,
}));
