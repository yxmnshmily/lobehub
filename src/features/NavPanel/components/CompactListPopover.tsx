'use client';

import { Popover, PopoverArrow } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import CompactListButton from '@/features/SuperGroup/CompactListButton';

const popupClassName = createStaticStyles(
  ({ css }) => css`
    box-sizing: border-box;

    /* 自适应宽度：窄窗口不低于 300px，宽窗口最多长到 460px，不再固定 300 */
    width: clamp(300px, 36vw, 460px);
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
      arrow
      nativeButton
      className={popupClassName}
      placement="rightTop"
      positionerProps={{ collisionPadding: 8, sideOffset: 10 }}
      trigger="click"
      content={
        <>
          {/* 贴边框的实心三角指针：浮动引擎自动贴在弹层左缘、指向触发图标。
              注意 popup 不能 overflow:hidden——那会把伸出边缘的三角裁掉，
              只剩层内一条细缝，看起来就像一个悬空的「‹」符号（已修复：
              popup 不再裁切，圆角由 content 层自己承担）。 */}
          <PopoverArrow />
          {children}
        </>
      }
      styles={{
        content: {
          /* 弹层显式浮层底色：默认透明时会透出下层内容（搜索弹层尤其明显） */
          background: cssVar.colorBgElevated,
          border: `0.5px solid ${cssVar.colorBorderSecondary}`,
          /* popup 不再 overflow:hidden（会裁掉贴边三角指针），圆角由这一层
             自己承担，保持与 popup 一致的圆角外观 */
          borderRadius: cssVar.borderRadius,
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
