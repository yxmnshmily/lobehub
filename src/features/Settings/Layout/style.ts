import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  contentSurface: css`
    position: relative;

    overflow: visible;
    flex: 1;

    min-width: 0;
    min-height: 0;
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};

    /*
     * FormGroup 的移动端分支（<768px）给标题条写死 colorBgLayout 填充（库样式，
     * 不随 variant 变化）。用结构化选择器只透明化标题条本身——不能整体覆盖
     * color-bg-layout token，因为切换胶囊（Tabs 分段控件）的轨道背景用的也是
     * 同一个 token，误杀会丢掉黑胶囊。
     */

    /*
     * FormGroup 移动端分支的标题条自带 colorBgLayout 填充（库样式，不随
     * variant 变化），深色下就是那条黑底。分组可能渲染在 Form 外（如
     * ChatAppearance 的独立组），所以不能用 .ant-form 前缀；改用标题条特征
     * （justify: space-between 的行内样式）定位。必须用 :not([style*='padding'])
     * 排除自带行内 padding 的元素——如服务商列表的吸顶搜索行（padding=8、
     * borderless 变体），否则会把它的背景也打成透明，列表文字透上来。
     */
    .lobe-flex[style*='justify: space-between']:not([style*='padding']) {
      background: transparent !important;
    }

    /*
     * 分段切换（Tabs）的轨道底色显式化：库默认用 color-bg-layout token，
     * 在不同宽度/覆盖下会退化成透明（黑胶囊消失）。这里固定为
     * colorFillQuaternary，保证所有设置页的切换控件都是图 1 的胶囊观感。
     */
    [role='tablist'] {
      background: ${cssVar.colorFillQuaternary};
    }

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

    /* 网站式滚动：本层高度随内容增长，不能裁剪（overflow hidden 会把
       超出视口的内容裁掉，导致框架层永远收不到溢出、无法滚动）。 */
    overflow: visible;
    box-sizing: border-box;
    background: ${cssVar.colorBgContainer};
  `,
}));
