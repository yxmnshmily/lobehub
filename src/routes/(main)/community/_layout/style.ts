import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Main container — the frame is owned by DesktopLayoutContainer (shared by
  // every main pane), so this layout must not draw a second one; a duplicated
  // border made the community pane look heavier than settings.
  mainContainer: css`
    position: relative;

    overflow: hidden;
    min-width: 0;
    min-height: 0;

    background: ${cssVar.colorBgContainer};
  `,
}));
