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
    scrollbar-color: ${cssVar.colorFillSecondary} transparent;

    /* 滚动条可见化：macOS 默认 overlay 滚动条只在滚动时闪现，看起来像"没有
       滚动条"。固定为细条（不随内容变化消失），颜色跟随主题。
       注意不能用 scrollbar-gutter: stable both-edges——它会在左右各预留
       ~8px 槽位，叠在 10px 内边距上，视觉边距变成 ~18px（用户实测）。 */
    scrollbar-width: thin;

    &::-webkit-scrollbar {
      width: 8px;
    }

    &::-webkit-scrollbar-thumb {
      border-radius: 4px;
      background: ${cssVar.colorFillSecondary};
    }

    &::-webkit-scrollbar-track {
      background: transparent;
    }

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
        height={'100%'}
        width={'100%'}
        style={{
          background:
            variant === 'secondary' ? theme.colorBgContainerSecondary : cssVar.colorBgContainer,
          /* 窄窗口下内容（如表单最小宽度、服务商卡片网格）超宽时允许横向滚动，
             底部出现左右滚动条；桌面端内容不超宽时不会显示滚动条。 */
          overflowX: 'auto',
          overflowY: 'auto',
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
