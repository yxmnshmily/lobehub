'use client';

import { Icon } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { TriangleAlert } from 'lucide-react';
import { type CSSProperties, memo } from 'react';

import { useTravelTranslation } from '@/utils/i18n/travel';

interface SilentFallbackProps {
  minHeight?: number;
  style?: CSSProperties;
}

const SilentFallback = memo<SilentFallbackProps>(({ minHeight = 36, style }) => {
  const translateTravel = useTravelTranslation();
  const theme = useTheme();

  return (
    <div
      style={{
        alignItems: 'center',
        border: `0.5px dashed ${theme.colorBorderSecondary}`,
        borderRadius: theme.borderRadiusSM,
        color: theme.colorTextQuaternary,
        display: 'flex',
        fontSize: 12,
        gap: 4,
        justifyContent: 'center',
        minHeight,
        ...style,
      }}
    >
      <Icon icon={TriangleAlert} size={'small'} />
      <span>{translateTravel('渲染错误')}</span>
    </div>
  );
});

SilentFallback.displayName = 'SilentFallback';

export default SilentFallback;
