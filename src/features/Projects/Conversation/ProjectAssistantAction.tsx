import { INSERT_MENTION_COMMAND } from '@lobehub/editor';
import { memo } from 'react';

import AgentSelectorAction from '@/features/AgentTaskManager/AgentSelectorAction';
import { useMentionCategories } from '@/features/ChatInput/InputEditor/useMentionCategories';
import { useConversationStore } from '@/features/Conversation';

// Projects keep the coordinator as topic owner. Choosing a collaborator uses
// the same mention payload and visibility rules as the composer's @ menu.
const ProjectAssistantAction = memo<{ assistantId: string }>(({ assistantId }) => {
  const editor = useConversationStore((s) => s.editor);
  const categories = useMentionCategories();
  const agents = categories
    .flatMap((category) => category.items)
    .filter((item) => item.metadata?.type === 'agent');

  return (
    <span title="项目助手负责统筹，选择其他成员会在输入框中 @ 邀请协作">
      <AgentSelectorAction
        allowedAgentIds={[assistantId, ...agents.map((item) => String(item.metadata?.id))]}
        ariaLabel="项目助手与邀请成员"
        assistantId={assistantId}
        assistantTitle="项目助手"
        onAgentChange={(id) => {
          if (!editor) return;
          if (id === assistantId) {
            editor.focus();
            return;
          }
          const agent = agents.find((item) => item.metadata?.id === id);
          if (!agent) return;
          editor.dispatchCommand(INSERT_MENTION_COMMAND, {
            label: String(agent.metadata?.label ?? agent.label),
            metadata: agent.metadata,
          });
          editor.focus();
        }}
      />
    </span>
  );
});

ProjectAssistantAction.displayName = 'ProjectAssistantAction';

export default ProjectAssistantAction;
