'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { type CSSProperties } from 'react';
import { memo, useEffect } from 'react';

import { CONVERSATION_MIN_WIDTH } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    flex-grow: 1;
    align-self: center;

    /* 页面统一左右边距：桌面端 20px；手机端由 shell 提供 10px gutter（见下方媒体查询） */
    padding-inline: var(--wide-screen-container-padding-inline, 20px);

    /*
     * No width transition here. The column starts from the narrow default and
     * switches to full width once the status store hydrates, so animating that
     * change made the page look like it "opens up" a moment after it appears.
     */

    @media (width <= 767px) {
      padding-inline: var(
        --mobile-page-inner-gutter,
        var(--wide-screen-container-padding-inline, 10px)
      ) !important;
    }
  `,
}));

interface WideScreenContainerProps extends FlexboxProps {
  /**
   * Force the inner column to span the full available width, bypassing the
   * centered `min(CONVERSATION_MIN_WIDTH, 100%)` cap. Used e.g. while
   * multi-selecting so the clickable rows fill the whole stream.
   */
  fullWidth?: boolean;
  minWidth?: number;
  onChange?: () => void;
  wrapperStyle?: CSSProperties;
}

const WideScreenContainer = memo<WideScreenContainerProps>(
  ({
    children,
    className,
    onChange,
    wrapperStyle,
    onClick,
    minWidth,
    fullWidth,
    paddingInline,
    style,
    ...rest
  }) => {
    const wideScreen = useGlobalStore(systemStatusSelectors.wideScreen);

    useEffect(() => {
      onChange?.();
    }, [onChange, wideScreen]);

    return (
      <Flexbox style={{ alignItems: 'center', ...wrapperStyle }} width={'100%'} onClick={onClick}>
        <Flexbox
          className={cx(styles.container, className)}
          style={
            {
              '--wide-screen-container-padding-inline':
                typeof paddingInline === 'number'
                  ? `${paddingInline}px`
                  : (paddingInline ?? (fullWidth ? '0px' : '20px')),
              ...style,
            } as CSSProperties
          }
          width={
            fullWidth || wideScreen
              ? '100%'
              : `min(var(--conversation-column-width, ${minWidth || CONVERSATION_MIN_WIDTH}px), 100%)`
          }
          {...rest}
        >
          {children}
        </Flexbox>
      </Flexbox>
    );
  },
  isEqual,
);

export default WideScreenContainer;
