'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { cssVar, useTheme } from 'antd-style';
import { CSS_MODIFIER_PADDING } from '@/features/Settings/features/cssModifierOverrides';
import { type PropsWithChildren, type ReactNode } from 'react';
import { memo } from 'react';

interface SettingContainerProps extends FlexboxProps {
  addonAfter?: ReactNode;
  addonBefore?: ReactNode;
  maxWidth?: number | string;
  variant?: 'default' | 'secondary';
}
/** 路由末段 → 留白表的 tab 键：/lobehub/settings/provider/all 归到 provider */
const routeTabKeyOf = (pathname: string) => {
  const clean = String(pathname || '').split('?')[0].replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  const at = parts.lastIndexOf('settings');
  if (at < 0 || at + 1 >= parts.length) return null;
  const seg = parts[at + 1];
  if (!/^[a-z][a-z0-9-]*$/.test(seg)) return null;
  return seg === 'all' && at + 2 < parts.length ? parts[at + 2] : seg;
};

const SettingContainer = memo<PropsWithChildren<SettingContainerProps>>(
  ({ variant, maxWidth = '100%', children, addonAfter, addonBefore, style, ...rest }) => {
    const theme = useTheme();
    const overridePadding = CSS_MODIFIER_PADDING[routeTabKeyOf(window.location.pathname) || ''];
    const overridePaddingStyle = overridePadding
      ? {
          paddingBottom: overridePadding.bottom,
          paddingLeft: overridePadding.left ?? overridePadding.right,
          paddingRight: overridePadding.right,
          paddingTop: overridePadding.top,
        }
      : undefined; // Keep for colorBgContainerSecondary (not in cssVar)
    return (
      <Flexbox
        align={'center'}
        height={'100%'}
        width={'100%'}
        style={{
          background:
            variant === 'secondary' ? theme.colorBgContainerSecondary : cssVar.colorBgContainer,
          overflowX: 'hidden',
          overflowY: 'auto',
          ...style,
          ...overridePaddingStyle,
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
