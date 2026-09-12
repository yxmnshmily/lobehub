import { type AssistantContentBlock, type UIChatMessage } from '@lobechat/types';
import { useResponsive } from 'antd-style';
import { memo, useMemo } from 'react';

import { MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES } from '@/const/messageActionPortal';

import { ReactionPicker } from '../../../components/Reaction';
import { messageStateSelectors, useConversationStore } from '../../../store';
import type { MessageActionsConfig } from '../../../types';
import {
  MessageActionBar,
  type MessageActionContext,
  type MessageActionSlot,
} from '../../components/MessageActionBar';
import { ASSISTANT_MENU } from '../../components/MessageActionBar/assistantMenu';

const DEFAULT_BAR_WITH_TOOLS: MessageActionSlot[] = ['delAndRegenerate', 'copy', 'download'];
const DEFAULT_BAR: MessageActionSlot[] = ['edit', 'copy', 'download'];
const IN_PROGRESS_BAR: MessageActionSlot[] = ['del'];
// Tool-only turns still support whole-reply operations. Do not show text
// actions with no target, or collapse a turn whose collapsed preview is empty.
const NO_TEXT_BLOCK_BAR: MessageActionSlot[] = ['delAndRegenerate', 'copy', 'download'];
const NO_TEXT_BLOCK_MENU = ASSISTANT_MENU.filter(
  (slot) => typeof slot !== 'string' || !['edit', 'collapse', 'tts', 'translate'].includes(slot),
);

interface GroupActionsProps {
  actionsConfig?: MessageActionsConfig;
  contentBlock?: AssistantContentBlock;
  contentId?: string;
  data: UIChatMessage;
  id: string;
}

export const GroupActionsBar = memo<GroupActionsProps>(
  ({ actionsConfig, id, data, contentBlock, contentId }) => {
    const ctx = useMemo<MessageActionContext>(
      () => ({ contentBlock, data, id, role: 'group' }),
      [contentBlock, data, id],
    );

    const isGenerating = useConversationStore(
      messageStateSelectors.isAssistantGroupItemGenerating(id),
    );

    // No text anywhere in the group, not merely a tool at the end.
    if (!contentId) {
      // Still streaming → only delete is meaningful.
      if (isGenerating) {
        return <MessageActionBar bar={IN_PROGRESS_BAR} ctx={ctx} />;
      }
      return <MessageActionBar bar={NO_TEXT_BLOCK_BAR} ctx={ctx} menu={NO_TEXT_BLOCK_MENU} />;
    }

    const defaultBar = data.tools ? DEFAULT_BAR_WITH_TOOLS : DEFAULT_BAR;

    return (
      <MessageActionBar
        bar={actionsConfig?.bar ?? defaultBar}
        ctx={ctx}
        leading={<ReactionPicker messageId={id} />}
        menu={actionsConfig?.menu ?? ASSISTANT_MENU}
      />
    );
  },
);

GroupActionsBar.displayName = 'GroupActionsBar';

/** Mobile has no reliable hover target, so its actions render with the message.
 * Desktop keeps the singleton portal to avoid mounting a full action tree per row. */
export const GroupActionsSlot = memo<GroupActionsProps>((props) => {
  const { mobile = false } = useResponsive();

  if (mobile) return <GroupActionsBar {...props} />;

  return (
    <div
      {...{ [MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES.assistantGroup]: '' }}
      style={{ height: '28px' }}
    />
  );
});

GroupActionsSlot.displayName = 'GroupActionsSlot';
