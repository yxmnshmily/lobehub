import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Header container
  headerContainer: css`
    border-block-end: 0.5px solid var(--header-border-color, ${cssVar.colorBorderSecondary});
  `,
}));
