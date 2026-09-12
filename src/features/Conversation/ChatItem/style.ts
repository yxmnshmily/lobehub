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
      position: relative;
      max-width: 100%;

      &[data-group-bubble] {
        padding-block: 12px;
        > .message-body {
          width: fit-content;
          max-width: min(90%, 960px);
        }
        > .message-body > .msg_content_flag {
          padding: 12px 16px;
          border-radius: 12px;
          background: ${cssVar.colorFillTertiary};
        }
        &:focus-within div[role='menubar'] {
          pointer-events: auto;
          opacity: 1;
        }
        @media (max-width: 768px) {
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
        background: ${cssVar.colorSuccessBg};
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
