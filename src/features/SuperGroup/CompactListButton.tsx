'use client';

import { Button } from '@lobehub/ui/base-ui';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

/** Shared native trigger for group, member and topic lists in the icon rail. */
export default function CompactListButton({
  icon: Icon,
  title,
  showLabel = false,
  showChevron = showLabel,
  style,
  ...props
}: Omit<ComponentProps<typeof Button>, 'icon'> & {
  icon: LucideIcon;
  title: string;
  showLabel?: boolean;
  showChevron?: boolean;
}) {
  return (
    <Button
      aria-label={title}
      data-nav-item=""
      title={title}
      type="text"
      {...props}
      style={{
        position: 'relative',
        width: '100%',
        height: 44,
        minHeight: 44,
        flexShrink: 0,
        justifyContent: showLabel ? 'flex-start' : 'center',
        gap: 8,
        padding: showLabel ? '0 24px 0 12px' : 0,
        ...style,
      }}
    >
      <Icon aria-hidden size={20} />
      {showLabel && (
        <span
          data-nav-label=""
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {title}
        </span>
      )}
      {showChevron && (
        <ChevronDown
          aria-hidden
          data-nav-chevron=""
          size={showLabel ? 12 : 10}
          style={{
            position: 'absolute',
            ...(showLabel
              ? { insetInlineEnd: 2, top: '50%', transform: 'translateY(-50%)' }
              : { left: '50%', top: 'calc(50% + 8px)', transform: 'translateX(-50%)' }),
          }}
        />
      )}
    </Button>
  );
}
