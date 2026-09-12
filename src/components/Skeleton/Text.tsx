'use client';

import { cssVar } from 'antd-style';
import type { CSSProperties } from 'react';
import { memo } from 'react';

import SkeletonBar from './Bar';

export interface SkeletonTextProps {
  animated?: boolean;
  className?: string;
  fontSize?: number;
  gap?: number;
  lineHeight?: number;
  rows?: number;
  style?: CSSProperties;
  width?: number | string | (number | string)[];
}

/**
 * Unified multi-line text placeholder.
 *
 * Mirrors the base-ui SkeletonText layout (row height and half-leading derived
 * from fontSize/lineHeight) but renders every row through {@link SkeletonBar},
 * so text placeholders share the same small radius and shrink behaviour as the
 * rest of the skeleton system instead of the base-ui default large radius.
 */
const SkeletonText = memo<SkeletonTextProps>(
  ({ rows = 1, fontSize, lineHeight = 1.6, gap, width, className, style }) => {
    const rowCount = Math.max(rows, 1);
    const base = fontSize === undefined ? cssVar.fontSize : `${fontSize}px`;
    const rowHeight = `round(calc(${base} * ${1 + (lineHeight - 1) * 0.5}), 1px)`;
    const halfLeading =
      gap === undefined ? `round(calc(${base} * ${(lineHeight - 1) * 0.25}), 1px)` : undefined;
    const widths = Array.isArray(width) ? width : undefined;

    const rowWidth = (index: number) => {
      if (widths) return widths[index] ?? widths.at(-1) ?? '100%';
      if (width !== undefined && !Array.isArray(width)) return width;
      return index === rowCount - 1 && rowCount > 1 ? '66%' : '100%';
    };

    return (
      <div
        className={className}
        style={{ display: 'flex', flexDirection: 'column', gap, width: '100%', ...style }}
      >
        {Array.from({ length: rowCount }).map((_, index) => (
          <SkeletonBar
            height={rowHeight}
            key={index}
            style={{ marginBlock: halfLeading }}
            width={rowWidth(index)}
          />
        ))}
      </div>
    );
  },
);

SkeletonText.displayName = 'SkeletonText';

export default SkeletonText;
