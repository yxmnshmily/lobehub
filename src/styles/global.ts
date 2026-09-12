import { CLASSNAMES } from '@lobehub/ui';
import type { Theme } from 'antd-style';
import { css } from 'antd-style';

// fix ios input keyboard
// overflow: hidden;
// ref: https://zhuanlan.zhihu.com/p/113855026
const genGlobalStyle = ({ token }: { prefixCls: string; token: Theme }) => css`
  html,
  body,
  #__next {
    position: relative;

    overscroll-behavior: none;

    height: 100%;
    min-height: 100dvh;
    max-height: 100dvh;

    @media (device-width >= 576px) {
      overflow: hidden;
    }
  }

  body {
    /* Own stacking context, otherwise render black edges will appear. Must NOT
       be a transform-based hack: a transform on body rebases every position:
       fixed descendant onto body, and a drawer panel mid slide-in then overflows
       body horizontally — focusing it scrolls the whole page sideways. */
    will-change: opacity;
    isolation: isolate;
  }

  * {
    scrollbar-color: ${token.colorFill} transparent;
    scrollbar-width: thin;

    ::-webkit-scrollbar {
      width: 0.75em;
      height: 0.75em;
    }

    ::-webkit-scrollbar-thumb {
      border-radius: 10px;
    }

    :hover::-webkit-scrollbar-thumb {
      border: 3px solid transparent;
      background-color: ${token.colorText};
      background-clip: content-box;
    }

    ::-webkit-scrollbar-track {
      background-color: transparent;
    }
  }

  html.desktop[data-theme='dark'] body {
    background-color: color-mix(in srgb, ${token.colorBgLayout} 50%, transparent);
  }

  html.desktop[data-theme='light'] body {
    background-color: color-mix(in srgb, ${token.colorBgLayout} 70%, transparent);
  }

  button {
    -webkit-app-region: no-drag;
  }

  [role='dialog'] img,
  [role='dialog'] video,
  .${token.prefixCls}-image-preview-img {
    border-radius: ${token.borderRadiusLG}px;
  }

  /* Scope to the shared image viewer's actual-size toolbar control. */
  [role='dialog'] .lobe-flex:has(> [data-actual-size]) {
    color: ${token.colorText};
    background: ${token.colorBgElevated};
    box-shadow: ${token.boxShadowSecondary};
    backdrop-filter: none;

    > div {
      font-weight: 600;
      color: ${token.colorText};
    }

    > button:not(:disabled):not([aria-disabled='true']) {
      color: ${token.colorText};

      &:hover {
        background: ${token.colorFillSecondary};
      }
    }
  }

  .${CLASSNAMES.ContextTrigger}[data-popup-open]:not([data-no-highlight]),
  .${CLASSNAMES.DropdownMenuTrigger}[data-popup-open]:not([data-no-highlight]) {
    background: ${token.colorFillTertiary};
  }
  .accordion-action:has(
    .${CLASSNAMES.DropdownMenuTrigger}[data-popup-open]:not([data-no-highlight])
  ) {
    opacity: 1;
  }

  /*
   * Hairline controls: buttons, text fields, selects and textareas all draw a
   * 0.5px border. Component libraries hard-code 1px inside their own hashed
   * styles, and those rules cannot be reached by class name, so the shared
   * element-level rule is where "everything is a 0.5px line" is enforced. Only
   * the width is overridden — colour, style and state borders stay untouched.
   */
  button,
  input,
  select,
  textarea,
  [role='button'],
  [role='textbox'] {
    border-width: 0.5px !important;
  }

  /* @lobehub/ui's Form styles hard-code this one to 1px on an antd class name,
     so it is reachable precisely instead of by hashed class. */
  .ant-collapse-header {
    border-block-end-width: 0.5px !important;
  }

  /* antd's borderless Collapse hard-codes the row rule to 1px inside its own
     stylesheet, where the lineWidth token cannot reach it. */
  .ant-collapse-borderless > .ant-collapse-item {
    border-block-end-width: 0.5px !important;
  }
`;

export default genGlobalStyle;
