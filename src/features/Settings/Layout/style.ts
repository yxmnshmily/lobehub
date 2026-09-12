import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  contentSurface: css`
    position: relative;

    overflow: hidden;
    flex: 1;

    min-width: 0;
    min-height: 0;
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};

    /*
     * Settings-only visual layer. The legacy filled FormGroup draws a tinted
     * shell, an outlined inner panel and a shadow at the same time. Flatten
     * that triple frame once here so every personal settings page inherits the
     * same DeepSeek-like hierarchy without rewriting its form logic.
     */
    .ant-form {
      gap: 32px !important;
    }

    .ant-collapse {
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    .ant-collapse > .ant-collapse-item {
      overflow: visible;

      border: 0 !important;
      border-radius: 0 !important;

      background: transparent !important;
      box-shadow: none !important;
    }

    .ant-collapse > .ant-collapse-item > .ant-collapse-header {
      min-height: 52px;
      padding-block: 12px 14px !important;
      padding-inline: 4px !important;
      border-block-end: 0.5px solid ${cssVar.colorBorderSecondary} !important;
      border-radius: 0 !important;

      background: transparent !important;
    }

    .ant-collapse .ant-collapse-header-text {
      font-size: 16px;
      font-weight: 600;
      line-height: 24px;
    }

    .ant-collapse .ant-collapse-panel {
      margin: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;

      background: transparent !important;
      box-shadow: none !important;
    }

    .ant-collapse .ant-collapse-content,
    .ant-collapse .ant-collapse-content-box,
    .ant-collapse .ant-collapse-body {
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    .ant-collapse .ant-form-item {
      padding-block: 16px !important;
      padding-inline: 4px !important;
    }

    .ant-collapse .ant-divider {
      margin: 0 !important;
      border-block-start-color: ${cssVar.colorBorderSecondary};
    }

    .ant-card {
      border-color: ${cssVar.colorBorderSecondary} !important;
      box-shadow: none !important;
    }

    .ant-input,
    .ant-input-affix-wrapper,
    .ant-input-number,
    .ant-select-selector,
    .ant-segmented,
    .ant-btn {
      box-shadow: none !important;
    }
  `,
  mainContainer: css`
    position: relative;
    overflow: hidden;
    box-sizing: border-box;
    background: ${cssVar.colorBgContainer};
  `,
}));
