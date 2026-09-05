import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  divider: css`
    height: 24px;
  `,

  innerContainerDark: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,

  innerContainerLight: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,

  outerContainer: css`
    position: relative;
  `,

  touchTargets: css`
    @media (pointer: coarse) {
      button,
      [role='button'],
      .ant-input-affix-wrapper,
      .ant-input:not(.ant-input-affix-wrapper > .ant-input),
      label:has([role='checkbox']) {
        min-block-size: 44px !important;
      }
    }
  `,
}));
