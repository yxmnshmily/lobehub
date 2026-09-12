'use client';

import { Popover } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import CompactListButton from '@/features/SuperGroup/CompactListButton';

const popupClassName = createStaticStyles(
  ({ css }) => css`
    overflow: hidden;
    box-sizing: border-box;
    width: 300px;
    max-width: min(var(--available-width), calc(100vw - 88px));
  `,
);

export default function CompactListPopover({
  children,
  icon,
  title,
  active = false,
  showLabel = false,
}: {
  children: ReactNode;
  icon: LucideIcon;
  title: string;
  active?: boolean;
  showLabel?: boolean;
}) {
  return (
    <Popover
      nativeButton
      className={popupClassName}
      content={children}
      placement="rightTop"
      positionerProps={{ collisionPadding: 8, sideOffset: 8 }}
      trigger="click"
      styles={{
        content: {
          maxHeight: 'min(600px, 75dvh)',
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: 8,
        },
      }}
    >
      <CompactListButton
        aria-current={active ? 'true' : undefined}
        icon={icon}
        showLabel={showLabel}
        title={title}
        style={
          active ? { background: cssVar.colorFillTertiary, color: cssVar.colorText } : undefined
        }
      />
    </Popover>
  );
}
