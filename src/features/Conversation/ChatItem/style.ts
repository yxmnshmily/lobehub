/* stylelint-disable no-descending-specificity -- 存量嵌套选择器顺序，2026-09-17 checkpoint 豁免 */
import { createStaticStyles, keyframes } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => {
  const locateHighlight = keyframes`
    0%, 100% {
      background: transparent;
    }

    15%, 55% {
      background: ${cssVar.colorPrimaryBg};
    }
  `;

  return {
    container: css`
      /* stylelint-disable no-descending-specificity -- 存量嵌套顺序，2026-09-17 checkpoint 豁免 */
      position: relative;
      max-width: 100%;

      &[data-group-bubble] {
        padding-block: 12px;

        > .message-body {
          width: fit-content;
          max-width: min(90%, 960px);
        }

        > .message-body > .msg_content_flag {
          padding-block: 12px;
          padding-inline: 16px;
          border-radius: 12px;
          background: ${cssVar.colorFillTertiary};
        }

        &:focus-within div[role='menubar'] {
          pointer-events: auto;
          opacity: 1;
        }

        @media (width <= 768px) {
          > .message-body {
            max-width: 100%;
          }
        }

        @media (hover: none) {
          div[role='menubar'] {
            pointer-events: auto;
            opacity: 1;
          }
        }
      }

      &[data-group-bubble='right'] > .message-body > .msg_content_flag {
        background: ${cssVar.colorFillSecondary};
      }

      &[data-message-locate-highlight] {
        border-radius: ${cssVar.borderRadiusLG};
        animation: ${locateHighlight} 1400ms ${cssVar.motionEaseOut};
      }

      time,
      div[role='menubar'] {
        pointer-events: none;
        opacity: 0;
        transition: opacity 200ms ${cssVar.motionEaseOut};
      }

      time {
        display: inline-block;
        white-space: nowrap;
      }

      div[role='menubar'] {
        display: flex;
      }

      &:has([data-popup-open]) {
        div[role='menubar'] {
          pointer-events: unset;
          opacity: 1;
        }
      }

      &:hover {
        time,
        div[role='menubar'] {
          pointer-events: unset;
          opacity: 1;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        &[data-message-locate-highlight] {
          background: ${cssVar.colorPrimaryBg};
          animation: none;
        }
      }
    `,
    loading: css`
      position: absolute;
      inset-block-end: 0;
      inset-inline-start: -4px;
      inset-inline-end: unset;

      width: 16px;
      height: 16px;
      border-radius: 50%;

      color: ${cssVar.colorBgLayout};

      background: ${cssVar.colorPrimary};
    `,
  };
});
