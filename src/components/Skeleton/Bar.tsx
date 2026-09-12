'use client';

import { Skeleton } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import type { CSSProperties } from 'react';

export interface SkeletonBarProps {
  className?: string;
  height: number | string;
  radius?: number | string;
  style?: CSSProperties;
  width?: number | string;
}

const SkeletonBar = ({ height, width = '100%', radius, className, style }: SkeletonBarProps) => (
  <Skeleton
    className={className}
    height={28}
    style={{
      borderRadius: radius ?? cssVar.borderRadiusSM,
      flexShrink: 1,
      height,
      margin: 0,
      maxHeight: height,
      maxWidth: '100%',
      minHeight: height,
      minWidth: 0,
      padding: 0,
      width,
      ...style,
    }}
  />
);

export default SkeletonBar;
