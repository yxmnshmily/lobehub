'use client';

import type { PopoverTrigger } from '@lobehub/ui';
import { ActionIcon, type ActionIconProps } from '@lobehub/ui/base-ui';
import { useResponsive } from 'antd-style';
import { isUndefined } from 'es-toolkit/compat';
import { memo } from 'react';
import useMergeState from 'use-merge-value';

import { usePermission } from '@/hooks/usePermission';
import { useServerConfigStore } from '@/store/serverConfig';

import { useActionBarContext } from '../context';
import { resolveActionAccessibleLabel } from './actionAccessibility';
import type { ActionDropdownProps } from './ActionDropdown';
import ActionDropdown from './ActionDropdown';
import type { ActionPopoverProps } from './ActionPopover';
import ActionPopover from './ActionPopover';

export interface ActionProps extends Omit<ActionIconProps, 'popover'> {
  dropdown?: Omit<ActionDropdownProps, 'children'>;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  popover?: ActionPopoverProps;
  showTooltip?: boolean;
  trigger?: PopoverTrigger;
}

const Action = memo<ActionProps>(
  ({
    showTooltip,
    loading,
    icon,
    title,
    dropdown,
    popover,
    open,
    onOpenChange,
    trigger,
    disabled,
    onClick,
    size,
    ...rest
  }) => {
    const [show, setShow] = useMergeState(false, {
      onChange: onOpenChange,
      value: open,
    });
    const { mobile = false } = useResponsive();
    const serverMobile = useServerConfigStore((s) => s.isMobile);
    const isMobile = mobile || serverMobile;
    const { actionSize, dropdownPlacement } = useActionBarContext();
    const { allowed: canUseChatInputAction, reason } = usePermission('create_content');
    const blocked = disabled || !canUseChatInputAction;
    const tooltipTitle = canUseChatInputAction ? title : reason;
    const accessibleLabel = resolveActionAccessibleLabel(rest['aria-label'], title);
    const iconNode = (
      <ActionIcon
        disabled={blocked}
        icon={icon}
        loading={loading}
        title={
          isUndefined(showTooltip)
            ? isMobile
              ? undefined
              : tooltipTitle
            : showTooltip
              ? tooltipTitle
              : undefined
        }
        tooltipProps={{
          placement: 'bottom',
        }}
        onClick={(e) => {
          if (blocked || loading) return;
          if (onClick) return onClick(e);
          setShow(true);
        }}
        {...rest}
        aria-label={accessibleLabel}
        size={
          actionSize ??
          size ?? {
            blockSize: isMobile ? 44 : 32,
            size: 18,
          }
        }
      />
    );

    if (blocked) return iconNode;

    if (dropdown)
      return (
        <ActionDropdown
          open={show}
          trigger={trigger}
          onOpenChange={setShow}
          {...dropdown}
          minWidth={isMobile ? '100%' : dropdown.minWidth}
          placement={isMobile ? 'top' : (dropdownPlacement ?? dropdown.placement)}
        >
          {iconNode}
        </ActionDropdown>
      );
    if (popover)
      return (
        <ActionPopover
          loading={loading}
          open={show}
          trigger={trigger}
          onOpenChange={setShow}
          {...popover}
          minWidth={isMobile ? '100%' : popover.minWidth}
          placement={isMobile ? 'top' : (dropdownPlacement ?? popover.placement)}
        >
          {iconNode}
        </ActionPopover>
      );

    return iconNode;
  },
);

export default Action;
