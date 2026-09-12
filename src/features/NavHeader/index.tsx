import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox, TooltipGroup } from '@lobehub/ui';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';

import ToggleLeftPanelButton, { isMacDesktop } from '@/features/NavPanel/ToggleLeftPanelButton';

export interface NavHeaderProps extends Omit<FlexboxProps, 'children'> {
  children?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  showTogglePanelButton?: boolean;
  slotClassNames?: {
    center?: string;
    left?: string;
    right?: string;
  };
  styles?: {
    center?: CSSProperties;
    left?: CSSProperties;
    right?: CSSProperties;
  };
}

const NavHeader = memo<NavHeaderProps>(
  ({
    showTogglePanelButton = true,
    style,
    children,
    left,
    right,
    slotClassNames,
    styles,
    ...rest
  }) => {
    const noContent = !left && !right && !children;

    // macOS desktop already has a persistent titlebar control.
    if (noContent && (isMacDesktop || !showTogglePanelButton)) return;

    return (
      <Flexbox
        allowShrink
        horizontal
        align={'center'}
        flex={'none'}
        gap={4}
        height={44}
        justify={'space-between'}
        paddingBlock={8}
        paddingInline={'var(--mobile-page-gutter, 8px)'}
        style={style}
        {...rest}
      >
        <TooltipGroup>
          <Flexbox
            allowShrink
            horizontal
            align={'center'}
            className={slotClassNames?.left}
            gap={2}
            justify={'flex-start'}
            style={{ minWidth: 0, ...styles?.left }}
          >
            {showTogglePanelButton && <ToggleLeftPanelButton id={null} />}
            {left}
          </Flexbox>
          {children && (
            <Flexbox
              className={slotClassNames?.center}
              flex={1}
              style={{ minWidth: 0, ...styles?.center }}
            >
              {children}
            </Flexbox>
          )}
          <Flexbox
            horizontal
            align={'center'}
            className={slotClassNames?.right}
            gap={2}
            justify={'flex-end'}
            style={{ flexShrink: 0, minWidth: 0, ...styles?.right }}
          >
            {right}
          </Flexbox>
        </TooltipGroup>
      </Flexbox>
    );
  },
);

export default NavHeader;
