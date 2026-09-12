// Disable the auto sort key eslint rule to make the code more logic and readable
import { LOADING_FLAT } from '@lobechat/const';
import { type SendGroupMessageParams } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { lambdaClient } from '@/libs/trpc/client';
import { type StreamEvent } from '@/services/agentRuntime';
import { agentRuntimeClient } from '@/services/agentRuntime';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

const log = debug('store:chat:ai-agent:agentGroup');

const n = setNamespace('aiAgentGroup');

type Setter = StoreSetter<ChatStore>;
export const agentGroupSlice = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ChatGroupChatActionImpl(set, get, _api);

export class ChatGroupChatActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  sendGroupMessage = async ({
    billing,
    context,
    message,
    files,
    onComplete,
    parentMessageId,
    parentOperationId,
  }: SendGroupMessageParams): Promise<boolean> => {
    if (!message.trim() && (!files || files.length === 0) && !parentMessageId) return false;

    const { agentId, groupId, topicId } = context;

    if (!agentId || !groupId) {
      log('sendGroupMessage: missing agentId or groupId in context');
      return false;
    }

    const { internal_handleAgentStreamEvent, optimisticCreateTmpMessage, startOperation } =
      this.#get();

    log(
      'sendGroupMessage: agentId=%s, groupId=%s, message=%s',
      agentId,
      groupId,
      message.slice(0, 50),
    );

    this.#set({ isCreatingMessage: true }, false, n('sendGroupMessage/start'));

    // 0. Create execServerAgentRuntime operation FIRST for correct loading state
    // This ensures isAgentRuntimeRunningByContext returns true during mutate call
    const tempUserId = 'tmp_' + nanoid();
    const tempAssistantId = 'tmp_' + nanoid();
    const fileIds = files?.map((f) => f.id);

    const { operationId: execOperationId, abortController: execAbortController } = startOperation({
      context: { ...context, messageId: tempUserId },
      label: 'Execute Server Agent',
      parentOperationId,
      type: 'execServerAgentRuntime',
    });

    let completionNotified = false;
    const notifyComplete = () => {
      if (completionNotified) return;
      completionNotified = true;
      onComplete?.();
    };

    // 1. Optimistic update - create temp messages immediately for instant UI feedback
    // Pass operationId so internal_dispatchMessage uses the correct context
    optimisticCreateTmpMessage(
      {
        agentId,
        content: message,
        files: fileIds,
        groupId,
        role: 'user',
        topicId: topicId ?? undefined,
      },
      { operationId: execOperationId, tempMessageId: tempUserId },
    );

    // Create temp assistant message (loading state)
    optimisticCreateTmpMessage(
      {
        agentId,
        content: LOADING_FLAT,
        groupId,
        role: 'assistant',
        topicId: topicId ?? undefined,
      },
      { operationId: execOperationId, tempMessageId: tempAssistantId },
    );

    try {
      // 2. Call backend execGroupAgent - creates messages and triggers Agent
      // Pass AbortSignal to allow cancellation during the API call
      const result = await lambdaClient.aiAgent.execGroupAgent.mutate(
        { agentId, billing, files: fileIds, groupId, message, parentMessageId, topicId },
        { signal: execAbortController.signal },
      );

      log(
        'execGroupAgent result: operationId=%s, topicId=%s, success=%s',
        result.operationId,
        result.topicId,
        result.success,
      );

      // 3. Update topics if new topic was created
      if (result.topics) {
        const pageSize = 20; // Default page size for topics
        this.#get().internal_updateTopics(agentId, {
          groupId,
          items: result.topics.items as any, // Type from DB may have null vs undefined differences
          pageSize,
          total: result.topics.total,
        });
      }

      // 4. Create execContext with updated topicId from server response
      const execContext = { ...context, topicId: result.topicId || topicId };

      // 5. Populate the new topic's message bucket BEFORE switching into it.
      //
      // Temp messages live under the original (topicId: null) bucket. switchTopic
      // both clears that bucket (clearNewKey) AND points the active view at the new
      // topicId. If we switched first, the view would land on the still-empty new
      // bucket for a frame — StoreUpdater resets displayMessages/messagesInit and
      // ChatList renders <SkeletonList/>, so the just-sent message visibly
      // disappears and then reappears once replaceMessages runs. Writing the new
      // bucket first means the view always finds messages already present on switch.
      //
      // Messages include assistant message with error if operation failed to start.
      if (result.messages) {
        this.#get().replaceMessages(result.messages, {
          action: n('sendGroupMessage/syncMessages'),
          context: execContext,
        });
      }

      // 6. Switch to new topic if created (its bucket is already populated above)
      if (result.isCreateNewTopic && result.topicId) {
        await this.#get().switchTopic(result.topicId, {
          clearNewKey: true,
          skipRefreshMessage: true,
        });
      }

      // 7. Clean up temp messages from the original bucket.
      // For the new-topic path switchTopic's clearNewKey already wiped them; for the
      // same-topic path replaceMessages above overwrote the bucket. This dispatch is
      // a defensive no-op in both cases, kept to guard partial-result edge cases.
      if (result.messages) {
        this.#get().internal_dispatchMessage(
          { ids: [tempUserId, tempAssistantId], type: 'deleteMessages' },
          { operationId: execOperationId },
        );
      }

      // 8. Check if operation failed to start (e.g., QStash unavailable)
      // In this case, messages are synced but we skip SSE connection
      if (result.success === false) {
        log('Agent operation failed to start: %s', result.error);
        // Complete the operation with error status
        this.#get().failOperation(execOperationId, {
          message: result.error || 'Agent operation failed to start',
          type: 'AgentStartupError',
        });
        if (parentOperationId) {
          this.#get().failOperation(parentOperationId, {
            message: result.error || 'Agent operation failed to start',
            type: 'AgentStartupError',
          });
        }
        notifyComplete();
        return true;
      }

      // 9. Create streaming context - use assistantMessageId from backend response
      const streamContext = {
        assistantId: result.assistantMessageId,
        content: '',
        reasoning: '',
        tmpAssistantId: tempAssistantId, // Used for cleanup if needed
      };

      // 10. Start child operation for SSE stream using backend operationId
      this.#get().startOperation({
        context: { ...execContext, messageId: result.assistantMessageId },
        label: 'Group Agent Stream',
        operationId: result.operationId,
        parentOperationId: execOperationId,
        type: 'groupAgentStream',
      });

      // Associate assistant message with both operations:
      // - execServerAgentRuntime (parent) - for isGenerating detection
      // - groupAgentStream (child) - for stream cancel handling
      this.#get().associateMessageWithOperation(result.assistantMessageId, execOperationId);
      this.#get().associateMessageWithOperation(result.assistantMessageId, result.operationId);

      // 11. Connect to SSE stream
      // Server will automatically close the connection after sending agent_runtime_end event
      let terminalEventReceived = false;
      const eventSource = agentRuntimeClient.createStreamConnection(result.operationId, {
        includeHistory: false,
        onConnect: () => {
          log('Stream connected to %s', result.operationId);
        },
        onDisconnect: () => {
          log('Stream disconnected from %s', result.operationId);
          // Complete both operations when stream disconnects (either by server close or client abort)
          this.#get().completeOperation(result.operationId);
          this.#get().completeOperation(execOperationId);
          notifyComplete();
        },
        onError: (error: Error) => {
          log('Stream error for %s: %O', result.operationId, error);
          // Closing the response body after a terminal server event can surface as
          // `BodyStreamBuffer was aborted`. The canonical assistant error/content
          // has already arrived in that case, so do not overwrite it with a
          // transport-level abort message.
          if (terminalEventReceived) return;
          // Fail the stream operation on error
          this.#get().failOperation(result.operationId, {
            message: error.message,
            type: 'AgentStreamError',
          });
          if (streamContext.assistantId) {
            this.#get().internal_handleAgentError(streamContext.assistantId, error.message);
          }
        },
        onEvent: async (event: StreamEvent) => {
          if (event.type === 'agent_runtime_end' || event.type === 'error') {
            terminalEventReceived = true;
          }
          await internal_handleAgentStreamEvent(result.operationId, event, streamContext);
          if (event.type === 'agent_runtime_end' || event.type === 'error') notifyComplete();
        },
      });

      // 12. Register cancel handler for aborting SSE stream
      this.#get().onOperationCancel(result.operationId, () => {
        log('Cancelling SSE stream for operation %s', result.operationId);
        eventSource.abort();
      });
      if (parentOperationId) this.#get().completeOperation(parentOperationId);
      return true;
    } catch (error) {
      // Check if this is an abort error (user cancelled the operation)
      const isAbortError =
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('cancelled'));

      if (isAbortError) {
        log('sendGroupMessage aborted by user');
        // Operation was cancelled by user, status already updated by cancelOperation
        // Just clean up temp messages
        this.#get().internal_dispatchMessage(
          {
            ids: [tempUserId, tempAssistantId],
            type: 'deleteMessages',
          },
          { operationId: execOperationId },
        );
      } else {
        log('sendGroupMessage failed: %O', error);
        console.error('Failed to send group message:', error);

        // Remove temp messages on error - use execOperationId for correct context
        this.#get().internal_dispatchMessage(
          {
            ids: [tempUserId, tempAssistantId],
            type: 'deleteMessages',
          },
          { operationId: execOperationId },
        );

        // Fail the execServerAgentRuntime operation
        this.#get().failOperation(execOperationId, {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'SendGroupMessageError',
        });
        if (parentOperationId) {
          this.#get().failOperation(parentOperationId, {
            message: error instanceof Error ? error.message : 'Unknown error',
            type: 'SendGroupMessageError',
          });
        }
      }
      return false;
    } finally {
      this.#set({ isCreatingMessage: false }, false, n('sendGroupMessage/end'));
    }
  };
}

export type ChatGroupChatAction = Pick<ChatGroupChatActionImpl, keyof ChatGroupChatActionImpl>;
