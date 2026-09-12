import { ChatInputActions, type ChatInputActionsProps } from '@lobehub/editor/react';
import { useMemo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { ActionBarContext, type DropdownPlacement } from './context';

/** Shared toolbar geometry. Callers supply only the actions their transport permits. */
export default function Toolbar({
  borderRadius,
  disableCollapse = false,
  dropdownPlacement,
  items,
  mobile,
}: {
  borderRadius?: number;
  disableCollapse?: boolean;
  dropdownPlacement?: DropdownPlacement;
  items: ChatInputActionsProps['items'];
  mobile?: boolean;
}) {
  const [expanded, toggleExpanded] = useGlobalStore((s) => [
    systemStatusSelectors.expandInputActionbar(s),
    s.toggleExpandInputActionbar,
  ]);
  const context = useMemo(
    () => ({ borderRadius, dropdownPlacement }),
    [borderRadius, dropdownPlacement],
  );
  return (
    <ActionBarContext value={context}>
      <ChatInputActions
        autoCollapse={!disableCollapse}
        collapseOffset={mobile ? 48 : 80}
        defaultGroupCollapse={!disableCollapse}
        groupCollapse={disableCollapse ? false : !expanded}
        items={items}
        style={{ paddingLeft: 6 }}
        onGroupCollapseChange={
          disableCollapse ? undefined : (collapsed) => toggleExpanded(!collapsed)
        }
      />
    </ActionBarContext>
  );
}
