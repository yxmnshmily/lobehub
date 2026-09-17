'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx, useTheme } from 'antd-style';
import { type PropsWithChildren, type ReactNode } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  /* 统一规格：桌面端保持各页面 props 传入的边距（如 48px）；低于 iPad mini
     （<768px）四边收成 10px，并把 FormGroup 移动端分支的内层填充（标题条/
     内容区各 16px）归零——无论嵌套多少层，内容到边缘就是 10px。
     标题条用行内 justify: space-between 定位；内容区 = 标题条的相邻兄弟。 */
  container: css`
    /* 容器不再承担滚动（网站式滚动已上移到 Settings/Layout 外壳），因此
       这里没有滚动条，内边距天然对称：桌面 48px / <768px 四边 10px。
       （此前的 thin 滚动条 + gutter 补偿方案随滚动上移一并移除。） */

    @media (width <= 767px) {
      padding-block: 10px !important;
      padding-inline: 10px !important;

      /* :not([style*='padding']) 排除自带行内 padding 的元素（如服务商列表
         吸顶搜索行 padding=8），避免清掉它们的水平填充。 */
      .lobe-flex[style*='justify: space-between']:not([style*='padding']) {
        padding-inline: 0 !important;
      }

      .lobe-flex[style*='justify: space-between']:not([style*='padding']) + * {
        padding-inline: 0 !important;
      }
    }
  `,
}));

interface SettingContainerProps extends FlexboxProps {
  addonAfter?: ReactNode;
  addonBefore?: ReactNode;
  maxWidth?: number | string;
  variant?: 'default' | 'secondary';
}
const SettingContainer = memo<PropsWithChildren<SettingContainerProps>>(
  ({
    className,
    variant,
    maxWidth = '100%',
    children,
    addonAfter,
    addonBefore,
    style,
    ...rest
  }) => {
    const theme = useTheme();
    return (
      <Flexbox
        align={'center'}
        className={cx(styles.container, className)}
        data-scroll-page=""
        width={'100%'}
        style={{
          background:
            variant === 'secondary' ? theme.colorBgContainerSecondary : cssVar.colorBgContainer,
          /* 高度随内容增长（滚动由外层 Settings/Layout 外壳承担），内容短时
             仍撑满整卡保证背景完整。 */
          minHeight: '100%',
          ...style,
        }}
        {...rest}
      >
        {addonBefore}
        <Flexbox
          flex={1}
          gap={36}
          width={'100%'}
          style={{
            maxWidth,
          }}
        >
          {children}
        </Flexbox>
        {addonAfter}
      </Flexbox>
    );
  },
);

export default SettingContainer;
