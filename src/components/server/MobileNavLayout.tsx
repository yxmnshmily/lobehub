import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ReactNode } from 'react';

import { MOBILE_TABBAR_HEIGHT } from '@/const/layoutTokens';

const navPaddingBottom = `calc(${MOBILE_TABBAR_HEIGHT}px + env(safe-area-inset-bottom))`;

const styles = createStaticStyles(({ css }) => ({
  content: css`
    --mobile-page-inner-gutter: 0px;

    /* 2026-09-16：隐藏本滚动容器的纵向滚动条。桌面经典滚动条约占 15px 且
       只占右侧内缘，使 padding-inline 10px 呈现为"左 10 / 右 25"的不对称留白
       （用户反馈手机端左右边距没对齐）。移动端 H5 惯例隐藏滚动条，
       滚轮与触摸滚动不受影响。 */
    scrollbar-width: none;

    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    min-height: 0;

    &::-webkit-scrollbar {
      display: none;
    }

    > * {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      min-height: 0;
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
    min-width: 0;
    max-width: 100%;
    min-height: 0;
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
