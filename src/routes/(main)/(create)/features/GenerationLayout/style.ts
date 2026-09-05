import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  mainContainer: css`
    position: relative;
    min-width: 0;
    width: 100%;
    overflow: hidden;
    background: ${cssVar.colorBgContainer};
  `,
}));
