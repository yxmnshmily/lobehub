import { memo } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import ConversationFrame from '@/features/SuperGroup/ConversationFrame';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';

import ConversationArea from './ConversationArea';
import ChatHeader from './Header';

const ChatConversation = memo(() => {
  const isMobile = useServerConfigStore((state) => state.isMobile);
  // Get current agent's model info for vision support check
  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const model = useAgentStore(agentSelectors.currentAgentModel);
  const provider = useAgentStore(agentSelectors.currentAgentModelProvider);
  const { handleUploadFiles } = useUploadFiles({ agentId, model, provider });

  return (
    <DragUploadZone style={{ height: '100%', width: '100%' }} onUploadFiles={handleUploadFiles}>
      <ConversationFrame header={<ChatHeader />}>
        <ConversationArea mobile={isMobile} />
      </ConversationFrame>
    </DragUploadZone>
  );
});

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
