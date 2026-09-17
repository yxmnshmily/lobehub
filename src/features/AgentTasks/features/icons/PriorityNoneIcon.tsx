'use client';

import type { IconType } from '@lobehub/icons';
import { memo } from 'react';

const Icon: IconType = memo(({ size = '1em', style, ...rest }) => {
  return (
    <svg
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      style={{ flex: 'none', lineHeight: 1, ...style }}
      viewBox="0 0 16 16"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <path d="M3 14V2m0 0c3-2 7 2 10 0v7c-3 2-7-2-10 0" />
    </svg>
  );
});

export default Icon;
