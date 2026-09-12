import { agentDisplayName } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { use } from 'react';

import { useAgentMeta } from '@/features/Conversation/hooks/useAgentMeta';
import { dataSelectors, useConversationStore } from '@/features/Conversation/store';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { GroupChatPresentation } from './GroupChatPresentation';
import { GroupMessageQuote } from './GroupMessageQuote';
import { parseAgentMessageQuote, parseMessageQuote } from './messageQuote';

export function useGroupMessageContent(content = ''): { content: string; referenceId?: string } {
  return use(GroupChatPresentation) ? parseAgentMessageQuote(content) : { content };
}

function AgentQuote({ id, referenceId }: { id: string; referenceId: string }) {
  const source = useConversationStore((s) => {
    const current = dataSelectors.getDbMessageById(id)(s);
    const original = dataSelectors.getDbMessageById(referenceId)(s);
    // Resolve only within the already authorized conversation. Never fetch an
    // arbitrary model-supplied ID or mistake a tool result for a member's words.
    if (
      !current?.groupId ||
      !current.topicId ||
      !original ||
      original.role !== 'assistant' ||
      !original.agentId ||
      original.groupId !== current.groupId ||
      original.topicId !== current.topicId
    )
      return undefined;
    // Continuing one's own work is not a reply to another member. Omit the
    // card silently even if the model unnecessarily emitted a reference.
    if (original.id === id || original.agentId === current.agentId) return null;
    return original;
  }, isEqual);
  const author = useAgentMeta(source?.agentId);
  if (source === null) return null;
  if (!source) return <span role="note">引用的原消息不在当前记录中</span>;

  const text =
    markdownToTxt(parseMessageQuote(parseAgentMessageQuote(source.content || '').content).content)
      .replaceAll(/\s+/g, ' ')
      .trim() || '[附件消息]';
  return (
    <GroupMessageQuote
      placement="left"
      quote={{
        id: source.id,
        name: agentDisplayName(author, '群成员'),
        excerpt: text.length > 240 ? `${text.slice(0, 240)}…` : text,
      }}
    />
  );
}

export function GroupAgentQuote({ id, referenceId }: { id: string; referenceId?: string }) {
  const groupChat = use(GroupChatPresentation);
  return groupChat && referenceId ? (
    <AgentQuote id={id} key={referenceId} referenceId={referenceId} />
  ) : null;
}
