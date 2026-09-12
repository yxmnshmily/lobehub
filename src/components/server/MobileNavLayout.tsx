import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ReactNode } from 'react';

import { MOBILE_TABBAR_HEIGHT } from '@/const/layoutTokens';

const navPaddingBottom = `calc(${MOBILE_TABBAR_HEIGHT}px + env(safe-area-inset-bottom))`;

const styles = createStaticStyles(({ css }) => ({
  content: css`
    --mobile-page-inner-gutter: 0px;

    box-sizing: border-box;
    min-height: 0;
    min-width: 0;
    max-width: 100%;

    > * {
      box-sizing: border-box;
      width: 100%;
      min-height: 0;
      min-width: 0;
      max-width: 100%;
    }

    img,
    video {
      max-width: 100%;
      height: auto;
    }

    canvas {
      max-width: 100%;
    }

    pre {
      overflow-x: auto;
      max-width: 100%;
    }
  `,
  frame: css`
    box-sizing: border-box;
    min-height: 0;
    min-width: 0;
    max-width: 100%;
  `,
}));

interface MobileContentLayoutProps extends FlexboxProps {
  header?: ReactNode;
  withNav?: boolean;
}

const MobileContentLayout = ({
  children,
  className,
  withNav,
  style,
  header,
  id = 'lobe-mobile-scroll-container',
  ...rest
}: MobileContentLayoutProps) => {
  const content = (
    <Flexbox
      className={cx(styles.content, className)}
      height="100%"
      id={id}
      width="100%"
      style={{
        backgroundColor: cssVar.colorBgContainer,
        boxSizing: 'border-box',
        maxWidth: '100%',
        minHeight: 0,
        minWidth: 0,
        overflowX: 'hidden',
        overflowY: 'auto',
        position: 'relative',
        ...style,
        paddingInline: 'var(--mobile-page-gutter, 10px)',
        paddingBottom: withNav ? navPaddingBottom : style?.paddingBottom,
      }}
      {...rest}
    >
      {children}
    </Flexbox>
  );

  if (!header) return content;

  return (
    <Flexbox
      className={styles.frame}
      height={'100%'}
      width={'100%'}
      style={{
        backgroundColor: cssVar.colorBgContainer,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {header}
      <Flexbox
        className={cx(styles.content, className)}
        height="100%"
        id={id ?? 'lobe-mobile-scroll-container'}
        width="100%"
        style={{
          backgroundColor: cssVar.colorBgContainer,
          boxSizing: 'border-box',
          maxWidth: '100%',
          minHeight: 0,
          minWidth: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          position: 'relative',
          ...style,
          paddingInline: 'var(--mobile-page-gutter, 10px)',
          paddingBottom: withNav ? navPaddingBottom : style?.paddingBottom,
        }}
        {...rest}
      >
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default MobileContentLayout;
