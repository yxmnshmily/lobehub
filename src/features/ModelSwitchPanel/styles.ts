import { createStaticStyles } from 'antd-style';

export const MOBILE_MODEL_DETAIL_WIDTH =
  'calc(100vw - max(16px, env(safe-area-inset-left)) - max(16px, env(safe-area-inset-right)))';

export const providerGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  columnGap: 4,
} as const;

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    pointer-events: auto;
    user-select: none;
    overflow: hidden;
    padding: 0 !important;
  `,
  detailPopup: css`
    user-select: none;

    overscroll-behavior: contain;

    box-sizing: border-box;

    /* 宽度自适应内容（2026-09-18 用户要求）：不再固定 400px——价格行
       （如 ¥42.00 ~ ¥77.00/百万 Token）一长就被裁掉。fit-content 跟随
       内容伸缩，上限仍受视口宽度保护。 */
    width: fit-content;
    min-width: min(320px, ${MOBILE_MODEL_DETAIL_WIDTH});
    max-width: ${MOBILE_MODEL_DETAIL_WIDTH};
  `,
  dropdownMenu: css`
    user-select: none;

    [role='menuitem'] {
      margin-block: 1px;
      margin-inline: 4px;
      padding-block: 8px;
      padding-inline: 8px;
      border-radius: ${cssVar.borderRadiusSM};
    }
  `,
  groupHeader: css`
    width: 100%;
    color: ${cssVar.colorTextSecondary};
  `,
  list: css`
    position: relative;
    overflow: hidden auto;
    overscroll-behavior: contain;
    width: 100%;
  `,
  menuItem: css`
    cursor: pointer;

    position: relative;

    gap: 8px;
    align-items: center;

    margin-block: 1px;
    margin-inline: 4px;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};
  `,
  menuItemActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  footer: css`
    border-block-start: 0.5px solid ${cssVar.colorBorderSecondary};
  `,
  toolbar: css`
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
  `,
  trigger: css`
    display: inline-flex;
    outline: none;

    /* SVG icons (from @lobehub/icons IconAvatar) can receive focus when dropdown closes,
       causing an unwanted blue outline ring */
    svg:focus {
      outline: none;
    }
  `,
}));
