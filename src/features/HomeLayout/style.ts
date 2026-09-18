import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Absolutely positioned container, fills parent
  absoluteContainer: css`
    position: absolute;
    inset: 0;
  `,

  // Content area - dark mode
  contentDark: css`
    overflow: hidden;
    background: linear-gradient(
      to bottom,
      ${cssVar.colorBgContainer},
      var(--content-bg-secondary, ${cssVar.colorBgContainer})
    );

    /* 手机端：首页全页铺满与对话框一致的背景色（用户要求） */
    @media (width <= 767px) {
      background: ${cssVar.colorBgContainer};
    }
  `,

  // Content area - light mode
  contentLight: css`
    overflow: hidden;
    background: var(--content-bg-secondary, ${cssVar.colorBgContainer});

    /* 手机端：同上，全页铺满对话框背景色 */
    @media (width <= 767px) {
      background: ${cssVar.colorBgContainer};
    }
  `,
}));
