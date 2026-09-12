'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import { type PropsWithChildren, type ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    --mobile-page-inner-gutter: 0px;

    position: relative;

    overflow-x: hidden;
    overflow-y: auto;
    flex: 1;

    min-width: 0;
    min-height: 0;
    padding-block: 16px 32px;
    padding-inline: var(--mobile-page-gutter, 10px);

    background: ${cssVar.colorBgContainer};
    overscroll-behavior: contain;

    > * {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }

    .ant-form {
      gap: 24px !important;
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }

    /* The shell owns the mobile gutter. Remove the second 16px inset added by
       Lobe Form's mobile group header/body so every page aligns to one grid. */
    .ant-form > div > div {
      min-width: 0;
      padding-inline: 0 !important;
      background: transparent !important;
    }

    .ant-form-item {
      padding-block: 12px !important;
    }

    .ant-form-item-control,
    .ant-form-item-control-input,
    .ant-form-item-control-input-content {
      min-width: 0 !important;
      max-width: 100%;
    }

    @media (width <= 575px) {
      /* A row that only contains a switch stays compact. Any input-heavy or
         compound row owns the whole line so its label can never collapse into
         one-character columns. */
      :is(
        .ant-form-item:not(:has(.ant-switch, [role='switch'])),
        .ant-form-item:has(.ant-switch, [role='switch']):has(
            :is(.ant-input, .ant-input-number, .ant-select, .ant-slider, textarea)
          )
      ) {
        .ant-form-item-row {
          flex-flow: column nowrap !important;
          gap: 8px;
          align-items: stretch !important;
        }

        :is(.ant-form-item-label, .ant-form-item-control) {
          flex: none !important;
          width: 100% !important;
          max-width: 100% !important;
        }

        .ant-form-item-label {
          padding: 0 !important;
          text-align: start !important;
        }

        .ant-form-item-label > label {
          width: 100%;
          height: auto;
          min-height: 22px;
          word-break: normal;
          white-space: normal;
        }
      }
    }

    /* Binary settings have ample room for label + control on a phone. Keep
       input-heavy fields vertical, but stop switches wasting a second row. */
    .ant-form-item:has(.ant-switch, [role='switch']):not(
        :has(:is(.ant-input, .ant-input-number, .ant-select, .ant-slider, textarea))
      )
      .ant-form-item-row {
      flex-flow: row nowrap !important;
      gap: 12px;
      align-items: center !important;
      justify-content: space-between;
    }

    .ant-form-item:has(.ant-switch, [role='switch']):not(
        :has(:is(.ant-input, .ant-input-number, .ant-select, .ant-slider, textarea))
      )
      .ant-form-item-label {
      flex: 1 1 auto !important;
      min-width: 0;
      padding: 0 !important;
      white-space: normal;
    }

    .ant-form-item:has(.ant-switch, [role='switch']):not(
        :has(:is(.ant-input, .ant-input-number, .ant-select, .ant-slider, textarea))
      )
      .ant-form-item-control {
      flex: none !important;
      width: auto !important;
    }

    .ant-tabs,
    .ant-segmented,
    .ant-select,
    .ant-input-affix-wrapper,
    .ant-input-number {
      max-width: 100%;
    }

    [role='tablist'] {
      scrollbar-width: none;
      overflow-x: auto;

      display: flex;

      width: 100%;
      min-width: 0;
      max-width: 100%;

      overscroll-behavior-inline: contain;
      scroll-padding-inline: 8px;
      touch-action: pan-x;
      -webkit-overflow-scrolling: touch;
    }

    [role='tablist']::-webkit-scrollbar {
      display: none;
    }

    [role='tab'] {
      flex: none;
      white-space: nowrap;
    }

    .ant-divider {
      margin: 0 !important;
      border-block-start-color: ${cssVar.colorBorderSecondary};
    }

    .ant-card,
    .ant-collapse,
    .ant-collapse-panel {
      box-shadow: none !important;
    }

    .ant-card {
      border-color: ${cssVar.colorBorderSecondary} !important;
    }
  `,
  root: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 100%;
    height: 100%;

    background: ${cssVar.colorBgContainer};

    @media (prefers-reduced-motion: reduce) {
      * {
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
      }
    }
  `,
}));

interface PersonalSettingsScaffoldProps extends PropsWithChildren {
  header: ReactNode;
}

const PersonalSettingsScaffold = ({ children, header }: PersonalSettingsScaffoldProps) => {
  return (
    <div className={styles.root} data-mobile-settings-layout="b">
      {header}
      <div className={styles.content} id="lobe-mobile-scroll-container">
        {children}
      </div>
    </div>
  );
};

export default PersonalSettingsScaffold;
