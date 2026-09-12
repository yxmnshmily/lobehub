import type { UIChatMessage } from '@lobechat/types';

export interface AccessibleGroupMessage {
  agentId?: string | null;
  content: string;
  executionMessages?: UIChatMessage[];
  fileList?: UIChatMessage['fileList'];
  id: string;
  imageList?: UIChatMessage['imageList'];
  kind: string;
  sender?: UIChatMessage['sender'];
  topicId?: string;
  visibleAt: Date | string;
}

/** Adapt only the server-authorized rows; never fetch or impersonate the group owner. */
export const toConversationMessages = (
  groupId: string,
  topicId: string | undefined,
  messages: AccessibleGroupMessage[],
  assistants: Array<{ id: string; isSupervisor: boolean }> = [],
): UIChatMessage[] =>
  messages.flatMap<UIChatMessage>((message) =>
    message.executionMessages?.length
      ? message.executionMessages.map((step) => ({
          ...step,
          groupId,
          metadata: {
            ...step.metadata,
            isSupervisor: assistants.some(
              (agent) => agent.id === step.agentId && agent.isSupervisor,
            ),
          },
        }))
      : [
          {
            agentId: message.kind === 'assistant' ? (message.agentId ?? undefined) : undefined,
            metadata:
              message.kind === 'assistant' && message.agentId
                ? {
                    isSupervisor: assistants.some(
                      (agent) => agent.id === message.agentId && agent.isSupervisor,
                    ),
                  }
                : undefined,
            content: message.content,
            ...(message.fileList ? { fileList: message.fileList } : {}),
            ...(message.imageList ? { imageList: message.imageList } : {}),
            createdAt: new Date(message.visibleAt).getTime(),
            groupId,
            id: message.id,
            role: message.kind === 'assistant' ? 'assistant' : 'user',
            sender:
              message.kind === 'self' || message.kind === 'assistant'
                ? undefined
                : (message.sender ?? {
                    fullName: message.kind === 'owner' ? '群主' : '成员',
                    id: `group:${groupId}:${message.kind}`,
                  }),
            topicId: message.topicId ?? topicId,
            updatedAt: new Date(message.visibleAt).getTime(),
          },
        ],
  );
