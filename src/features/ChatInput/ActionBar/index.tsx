import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { memo, useMemo } from 'react';

import { type ActionKey, type ActionKeys } from '../ActionBar/config';
import { actionMap } from '../ActionBar/config';
import { useChatInputResourceAccess } from '../hooks/useChatInputResourceAccess';
import { useChatInputStore } from '../store';
import { type DropdownPlacement } from './context';
import { filterChatOnlyActions } from './filterChatOnlyActions';
import Toolbar from './Toolbar';

const mapActionToItem = (actionKey: ActionKey) => {
  const Render = actionMap[actionKey];

  return {
    alwaysDisplay: actionKey === 'contextWindow',
    children: <Render key={actionKey} />,
    key: actionKey,
  };
};

const mapActionsToItems = (
  keys: ActionKeys[],
  { disableCollapse = false }: { disableCollapse?: boolean } = {},
): ChatInputActionsProps['items'] =>
  keys.flatMap((actionKey, index) => {
    if (typeof actionKey === 'string') {
      if (actionKey === '---') {
        return {
          key: `divider-${index}`,
          type: 'divider',
        };
      }

      return mapActionToItem(actionKey);
    }

    if (disableCollapse) return actionKey.map(mapActionToItem);

    return {
      children: actionKey.map((groupActionKey) => mapActionToItem(groupActionKey)),
      key: `group-${index}`,
      type: 'collapse',
    };
  });

export interface ActionToolbarProps {
  borderRadius?: number;
  disableCollapse?: boolean;
  dropdownPlacement?: DropdownPlacement;
  extraActionItems?: ChatInputActionsProps['items'];
}

const ActionToolbar = memo<ActionToolbarProps>(
  ({ borderRadius, disableCollapse = false, dropdownPlacement, extraActionItems = [] }) => {
    const { canConfigureResource, canShowControls } = useChatInputResourceAccess();

    const leftActions = useChatInputStore((s) => {
      const actions = s.leftActions
        .map((item) =>
          Array.isArray(item)
            ? item.filter((key) => key !== 'typo' && !(s.readOnlyConfig && key === 'clear'))
            : item,
        )
        .filter(
          (item) =>
            item !== 'typo' &&
            !(s.readOnlyConfig && item === 'clear') &&
            (!Array.isArray(item) || item.length > 0),
        );
      return canConfigureResource ? actions : filterChatOnlyActions(actions);
    });

    const mobile = useChatInputStore((s) => s.mobile);

    const items = useMemo(
      () => (mapActionsToItems(leftActions, { disableCollapse }) ?? []).concat(extraActionItems),
      [disableCollapse, extraActionItems, leftActions],
    );

    if (!canShowControls) return null;

    return (
      <Toolbar
        borderRadius={borderRadius}
        disableCollapse={disableCollapse}
        dropdownPlacement={dropdownPlacement}
        items={items}
        mobile={mobile}
      />
    );
  },
);

export default ActionToolbar;
