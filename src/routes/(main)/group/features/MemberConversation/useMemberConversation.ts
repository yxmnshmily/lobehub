'use client';

import { GROUP_CHAT_TOPIC_URL, GROUP_CHAT_URL, GROUP_RECENT_MESSAGE_LIMIT } from '@lobechat/const';
import { uuid } from '@lobechat/utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import type { ConversationHooks } from '@/features/Conversation/types';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';
import { parseMentionedAgentsFromEditorData } from '@/store/chat/slices/agentRun/actions/entries/commandBus/parseCommands';

import type { MemberGroupSummary } from '../../_layout/useGroupRouteAccess';

const MEMBER_HOSTED_TRAVEL_AI_MAX_PROMPT_LENGTH = 4000;
const MEMBER_HOSTED_TRAVEL_AI_POLL_INTERVAL_MS = 2000;
const MEMBER_HOSTED_TRAVEL_AI_SLOW_POLL_MS = 10_000;

type HostedTravelAiStatus =
  'completed' | 'failed' | 'idle' | 'interrupted' | 'queued' | 'running' | 'submitting' | 'waiting';

const runtimeStatusAliases: Record<string, HostedTravelAiStatus> = {
  done: 'completed',
  error: 'failed',
  waiting_for_async_tool: 'running',
  waiting_for_human: 'waiting',
};

const isHostedRunStatus = (
  status: unknown,
): status is Exclude<HostedTravelAiStatus, 'idle' | 'submitting'> =>
  status === 'queued' ||
  status === 'running' ||
  status === 'waiting' ||
  status === 'completed' ||
  status === 'failed' ||
  status === 'interrupted';

const isUnavailableError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    data?: { code?: unknown };
    message?: unknown;
    shape?: { data?: { code?: unknown } };
  };
  return (
    candidate.data?.code === 'NOT_FOUND' ||
    candidate.shape?.data?.code === 'NOT_FOUND' ||
    candidate.message === 'GROUP_CONVERSATION_ACCESS_UNAVAILABLE'
  );
};

export const useMemberConversation = (group: MemberGroupSummary, onUnavailable: () => void) => {
  const queryUtils = lambdaQuery.useUtils();
  const [searchParams] = useSearchParams();
  const params = useParams<{ topicId?: string }>();
  const router = useQueryRoute();
  const requestedTopicId = params.topicId || searchParams.get('topic') || undefined;
  const [activeTopicId, setActiveTopicId] = useState<string>();
  const [mentionedAgentIds, setMentionedAgentIds] = useState<string[]>([]);
  const [aiTaskStatus, setAiTaskStatus] = useState<HostedTravelAiStatus>('idle');
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<string>();
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);
  const [isInterruptingAiTask, setIsInterruptingAiTask] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [topicTitle, setTopicTitle] = useState('');
  const topicLock = useRef(false);
  const aiTaskLock = useRef(false);
  const hostedRunHandle = useRef<string | undefined>(undefined);
  const hostedRunGeneration = useRef(0);
  const hostedRunPollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const messageLock = useRef(false);
  const viewGeneration = useRef(0);

  const topicsQuery = lambdaQuery.groupConversation.listTopics.useQuery(
    { groupId: group.groupId, limit: 20, recent: true },
    { gcTime: 0, refetchOnWindowFocus: true, refetchInterval: 5000, retry: false },
  );
  const participantsQuery = lambdaQuery.groupMembership.listParticipants.useQuery(
    { groupId: group.groupId, limit: 50, offset: 0 },
    { gcTime: 0, refetchOnWindowFocus: true, refetchInterval: 5000, retry: false },
  );
  const messagesQuery = lambdaQuery.groupConversation.listTextMessages.useInfiniteQuery(
    { order: 'latest', groupId: group.groupId, limit: 50, topicId: requestedTopicId },
    {
      enabled: Boolean(requestedTopicId || activeTopicId),
      maxPages: requestedTopicId ? undefined : 4,
      gcTime: 0,
      refetchOnWindowFocus: true,
      refetchInterval: 5000,
      retry: false,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );
  const publishedMessagesQuery =
    lambdaQuery.groupConversation.listPublishedAssistantMessages.useQuery(
      {
        groupId: group.groupId,
        includeInProgress: true,
        topicId: requestedTopicId,
        recent: !requestedTopicId,
      },
      {
        enabled: Boolean(requestedTopicId || activeTopicId),
        gcTime: 0,
        refetchOnWindowFocus: true,
        refetchInterval: 5000,
        retry: false,
      },
    );
  useEffect(() => {
    // Fill the finite recent window, never walk the entire group's history.
    if (
      !requestedTopicId &&
      messagesQuery.hasNextPage &&
      (messagesQuery.data?.pages.length ?? 0) < 4 &&
      !messagesQuery.isFetchingNextPage &&
      !messagesQuery.isError
    )
      void messagesQuery.fetchNextPage();
  }, [requestedTopicId, messagesQuery]);
  const createTopicMutation = lambdaQuery.groupConversation.createTopic.useMutation();
  const createTextMessageMutation = lambdaQuery.groupConversation.createTextMessage.useMutation();
  const updateTextMessageMutation = lambdaQuery.groupConversation.updateTextMessage.useMutation();
  const startHostedTravelGroupTaskMutation =
    lambdaQuery.aiAgent.startHostedTravelGroupTask.useMutation();
  const interruptHostedTravelGroupRunMutation =
    lambdaQuery.aiAgent.interruptHostedTravelGroupRun.useMutation();

  const topics = useMemo(
    () => (topicsQuery.data?.items ?? []).slice(0, 20),
    [topicsQuery.data?.items],
  );
  const assistants = (participantsQuery.data?.assistants ?? []).filter(
    (agent) => !agent.isSupervisor,
  );
  const mentionedAgents = assistants.filter((agent) => mentionedAgentIds.includes(agent.id));
  const messages = useMemo(() => {
    const humanMessages = (messagesQuery.data?.pages ?? [])
      .flatMap((page) => page.items)
      .map((message) => ({
        content: message.content,
        id: message.publicMessageId,
        kind: message.authorKind,
        sender: message.sender,
        fileList: message.fileList,
        imageList: message.imageList,
        topicId: message.topicId,
        visibleAt: message.visibleAt,
      }));
    const publishedMessages = (publishedMessagesQuery.data ?? []).map((message) => ({
      agentId: message.agentId,
      content: message.content,
      executionMessages: message.executionMessages,
      isGenerating: message.isGenerating,
      fileList: message.fileList,
      imageList: message.imageList,
      id: message.id,
      kind: message.kind,
      topicId: message.topicId,
      visibleAt: message.visibleAt,
    }));
    const sorted = [...humanMessages, ...publishedMessages].sort(
      (a, b) =>
        new Date(a.visibleAt).getTime() - new Date(b.visibleAt).getTime() ||
        a.id.localeCompare(b.id),
    );
    return requestedTopicId ? sorted : sorted.slice(-GROUP_RECENT_MESSAGE_LIMIT);
  }, [messagesQuery.data, publishedMessagesQuery.data, requestedTopicId]);
  const accessUnavailable =
    (topicsQuery.isError && isUnavailableError(topicsQuery.error)) ||
    (messagesQuery.isError && isUnavailableError(messagesQuery.error)) ||
    (publishedMessagesQuery.isError && isUnavailableError(publishedMessagesQuery.error));
  const canInterruptAiTask =
    aiTaskStatus === 'queued' || aiTaskStatus === 'running' || aiTaskStatus === 'waiting';

  const clearHostedRun = useCallback(() => {
    hostedRunGeneration.current += 1;
    hostedRunHandle.current = undefined;
    aiTaskLock.current = false;
    if (hostedRunPollTimer.current) {
      clearTimeout(hostedRunPollTimer.current);
      hostedRunPollTimer.current = undefined;
    }
  }, []);

  useEffect(() => {
    viewGeneration.current += 1;
    clearHostedRun();
    setActiveTopicId(undefined);
    setMentionedAgentIds([]);
    setAiTaskStatus('idle');
    setDraft('');
    setFeedback(undefined);
    setTopicTitle('');
    setIsCreatingTopic(false);
    setIsSending(false);
    setIsInterruptingAiTask(false);
    topicLock.current = false;
    messageLock.current = false;
  }, [clearHostedRun, group.groupId, group.membershipVersion]);

  useEffect(
    () => () => {
      viewGeneration.current += 1;
      clearHostedRun();
    },
    [clearHostedRun],
  );

  useEffect(() => {
    if (accessUnavailable) return;
    if (topicsQuery.data && topics.length === 0) {
      setActiveTopicId(undefined);
      return;
    }
    if (!activeTopicId && topics.length > 0) {
      setActiveTopicId(topics[0].id);
    }
  }, [accessUnavailable, activeTopicId, requestedTopicId, topics, topicsQuery.data]);

  const selectTopic = (topicId: string) => {
    setActiveTopicId(topicId);
    // Polling can report the same result topic many times. Replacing the already
    // active recent route on every status update restarts navigation and can
    // keep the newly published reply off screen until a manual refresh.
    if (requestedTopicId) router.replace(GROUP_CHAT_URL(group.groupId), { replace: true });
  };

  useEffect(() => {
    if (!accessUnavailable) return;
    viewGeneration.current += 1;
    clearHostedRun();
    setActiveTopicId(undefined);
    setAiTaskStatus('idle');
    setDraft('');
    setMentionedAgentIds([]);
    setTopicTitle('');
    onUnavailable();
  }, [accessUnavailable, clearHostedRun, onUnavailable]);

  const createTopic = async () => {
    const title = topicTitle.trim();
    if (!title || topicLock.current) return;

    topicLock.current = true;
    setIsCreatingTopic(true);
    setFeedback(undefined);
    const generation = viewGeneration.current;
    try {
      const created = await createTopicMutation.mutateAsync({
        groupId: group.groupId,
        idempotencyKey: uuid(),
        title,
      });
      if (generation !== viewGeneration.current) return;
      setTopicTitle('');
      selectTopic(created.id);
      await topicsQuery.refetch();
    } catch (error) {
      if (generation !== viewGeneration.current) return;
      if (isUnavailableError(error)) onUnavailable();
      else setFeedback('话题未创建，请重试');
    } finally {
      if (generation === viewGeneration.current) {
        topicLock.current = false;
        setIsCreatingTopic(false);
      }
    }
  };

  const sendMessage = async (editorContent?: string, fileIds?: string[]) => {
    const content = (editorContent ?? draft).trim();
    if (
      !content ||
      messageLock.current ||
      aiTaskLock.current ||
      topicLock.current ||
      accessUnavailable
    )
      return;
    if (content.length > 8000) {
      setFeedback('消息最多8000字，请缩短后发送');
      return;
    }

    messageLock.current = true;
    setIsSending(true);
    setFeedback(undefined);
    const generation = viewGeneration.current;
    try {
      let targetTopicId = activeTopicId;
      if (!targetTopicId) {
        const created = await createTopicMutation.mutateAsync({
          groupId: group.groupId,
          idempotencyKey: uuid(),
          title: content.slice(0, 100),
        });
        if (generation !== viewGeneration.current) return;
        targetTopicId = created.id;
        selectTopic(targetTopicId);
        void topicsQuery.refetch();
      }
      await createTextMessageMutation.mutateAsync({
        content,
        ...(fileIds?.length ? { fileIds } : {}),
        groupId: group.groupId,
        idempotencyKey: uuid(),
        topicId: targetTopicId,
      });
      if (generation !== viewGeneration.current) return;
      setDraft('');
      if (requestedTopicId) selectTopic(targetTopicId);
      void queryUtils.groupConversation.listTextMessages.invalidate({
        groupId: group.groupId,
      });
      return true;
    } catch (error) {
      if (generation !== viewGeneration.current) return;
      if (isUnavailableError(error)) onUnavailable();
      else setFeedback('消息未发送，请重试');
    } finally {
      if (generation === viewGeneration.current) {
        messageLock.current = false;
        setIsSending(false);
      }
    }
  };

  const handoffToTravelHostAi = async (
    editorContent?: string,
    fileIds?: string[],
    selectedAgentIds = mentionedAgentIds,
    regenerateMessageId?: string,
  ) => {
    const prompt = (editorContent ?? draft).trim();
    if ((!prompt && !regenerateMessageId) || aiTaskLock.current || messageLock.current) return;
    if (!regenerateMessageId && prompt.length > MEMBER_HOSTED_TRAVEL_AI_MAX_PROMPT_LENGTH) {
      setFeedback(
        `AI任务最多${MEMBER_HOSTED_TRAVEL_AI_MAX_PROMPT_LENGTH}字，请缩短内容；普通聊天仍可发送`,
      );
      return;
    }
    if (
      selectedAgentIds.length &&
      (selectedAgentIds.some((id) => !assistants.some((agent) => agent.id === id)) ||
        participantsQuery.isError)
    ) {
      setFeedback('该助理已不可用，请重新选择群内助理');
      return;
    }

    aiTaskLock.current = true;
    setAiTaskStatus('submitting');
    setFeedback(undefined);
    const admissionGeneration = hostedRunGeneration.current;
    try {
      const result = await startHostedTravelGroupTaskMutation.mutateAsync({
        billing: {
          idempotencyKey: uuid(),
        },
        groupId: group.groupId,
        ...(regenerateMessageId
          ? { regenerateMessageId }
          : {
              ...(selectedAgentIds.length ? { mentionedAgentIds: selectedAgentIds } : {}),
              ...(fileIds?.length ? { fileIds } : {}),
              prompt,
            }),
      });
      if (hostedRunGeneration.current !== admissionGeneration) return;
      if (
        result.accepted !== true ||
        typeof result.runHandle !== 'string' ||
        !/^[\w-]{43}$/.test(result.runHandle)
      ) {
        throw new Error('INVALID_HOSTED_RUN_HANDLE');
      }

      setDraft('');
      if (result.resultTopicId) selectTopic(result.resultTopicId);
      void topicsQuery.refetch();
      hostedRunHandle.current = result.runHandle;
      const generation = hostedRunGeneration.current + 1;
      hostedRunGeneration.current = generation;

      const pollHostedRun = async (attempt: number): Promise<void> => {
        if (
          hostedRunGeneration.current !== generation ||
          hostedRunHandle.current !== result.runHandle
        ) {
          return;
        }

        try {
          const safeStatus = await lambdaClient.aiAgent.getHostedTravelGroupRunStatus.query({
            groupId: group.groupId,
            runHandle: result.runHandle,
          });
          if (
            hostedRunGeneration.current !== generation ||
            hostedRunHandle.current !== result.runHandle
          ) {
            return;
          }
          const status = runtimeStatusAliases[safeStatus.status] ?? safeStatus.status;
          if (!isHostedRunStatus(status)) {
            throw new Error('INVALID_HOSTED_RUN_STATUS');
          }

          setFeedback(undefined);
          setAiTaskStatus(status);
          if (safeStatus.resultTopicId) selectTopic(safeStatus.resultTopicId);
          if (status === 'completed') {
            clearHostedRun();
            // Invalidate the verified result scope, not the pre-admission render's topic observer.
            const resultTopicId = safeStatus.resultTopicId ?? result.resultTopicId;
            await Promise.all([
              queryUtils.groupConversation.listTopics.invalidate({ groupId: group.groupId }),
              ...(resultTopicId
                ? [
                    queryUtils.groupConversation.listTextMessages.invalidate({
                      groupId: group.groupId,
                    }),
                    queryUtils.groupConversation.listPublishedAssistantMessages.invalidate({
                      groupId: group.groupId,
                    }),
                  ]
                : []),
            ]);
            return;
          }
          if (status === 'failed') {
            clearHostedRun();
            setFeedback('任务执行失败，请稍后重试');
            return;
          }
          if (status === 'interrupted') {
            clearHostedRun();
            return;
          }
          hostedRunPollTimer.current = setTimeout(
            () => {
              void pollHostedRun(attempt + 1);
            },
            attempt < 20
              ? MEMBER_HOSTED_TRAVEL_AI_POLL_INTERVAL_MS
              : MEMBER_HOSTED_TRAVEL_AI_SLOW_POLL_MS,
          );
        } catch (error) {
          // A previous group's in-flight poll must not invalidate the current conversation.
          if (hostedRunGeneration.current !== generation) return;
          if (isUnavailableError(error)) {
            clearHostedRun();
            setAiTaskStatus('failed');
            setFeedback('任务状态已不可用');
            onUnavailable();
          } else {
            setFeedback('任务状态暂时无法读取，正在自动重试');
            hostedRunPollTimer.current = setTimeout(() => {
              void pollHostedRun(attempt + 1);
            }, MEMBER_HOSTED_TRAVEL_AI_SLOW_POLL_MS);
          }
        }
      };

      await pollHostedRun(1);
      return true;
    } catch (error) {
      if (hostedRunGeneration.current !== admissionGeneration) return;
      clearHostedRun();
      setAiTaskStatus('idle');
      if (isUnavailableError(error)) onUnavailable();
      else if (
        error instanceof Error &&
        error.message.includes('[ORIGINAL_GROUP_REQUEST_UNAVAILABLE]')
      ) {
        setFeedback('此记录未保存完整原始请求，无法重新生成；请重新发送原始要求和附件。');
      } else if (error instanceof Error && error.message.includes('[GROUP_OWNER_CREDITS_EMPTY]')) {
        setFeedback(
          '该群主余额不足，AI 任务未启动。请联系群主补充积分；仍可选择“仅发送群消息，不调用 AI”。',
        );
      } else if (
        error instanceof Error &&
        (error.message.includes('[PLATFORM_CREDITS_FLOOR]') ||
          error.message.includes('[PLATFORM_CREDITS_EMPTY]'))
      ) {
        setFeedback('积分预算不足：余额低于 5 万，AI 任务未启动。充值后可继续，当前输入已保留。');
      } else setFeedback('旅游群主AI未受理，请重试');
    }
  };

  const interruptTravelHostAi = async () => {
    const runHandle = hostedRunHandle.current;
    if (!runHandle || !canInterruptAiTask || isInterruptingAiTask) return;

    setIsInterruptingAiTask(true);
    setFeedback(undefined);
    try {
      const result = await interruptHostedTravelGroupRunMutation.mutateAsync({
        groupId: group.groupId,
        runHandle,
      });
      if (result.interrupted) {
        clearHostedRun();
        setAiTaskStatus('interrupted');
      } else {
        setFeedback('任务未能停止，请稍后重试');
      }
    } catch (error) {
      clearHostedRun();
      setAiTaskStatus('failed');
      if (isUnavailableError(error)) {
        setFeedback('任务状态已不可用');
        onUnavailable();
      } else {
        setFeedback('任务暂时无法停止');
      }
    } finally {
      setIsInterruptingAiTask(false);
    }
  };

  const updatePublishedMessage = async (id: string, content: string | null) => {
    const message = messages.find((item) => item.id === id);
    if (!message || message.kind !== 'self') throw new Error('只能修改自己发送的消息');
    await updateTextMessageMutation.mutateAsync({
      groupId: group.groupId,
      publicMessageId: id,
      visibleAt: new Date(message.visibleAt),
      content,
    });
    await queryUtils.groupConversation.listTextMessages.invalidate({ groupId: group.groupId });
  };
  const conversationHooks: ConversationHooks = {
    canPerformMessageAction: (action, id) => {
      const message = messages.find(
        (item) =>
          item.id === id ||
          ('executionMessages' in item && item.executionMessages?.some((step) => step.id === id)),
      );
      if (!message) return false;
      if (['copy', 'download', 'collapse', 'restoreToInput'].includes(action)) return true;
      if ('isGenerating' in message && message.isGenerating) return false;
      if (aiTaskLock.current || messageLock.current) return false;
      if (action === 'regenerate') return message.kind === 'self' || message.kind === 'assistant';
      return ['edit', 'del'].includes(action) && message.kind === 'self';
    },
    onAddUserMessage: async ({ message, fileList }) =>
      Boolean(await sendMessage(message, fileList)),
    onSendMessage: async ({ message, files, onlyAddUserMessage, editorData }) =>
      Boolean(
        await (onlyAddUserMessage
          ? sendMessage(
              message,
              files?.map((file) => file.id),
            )
          : handoffToTravelHostAi(
              message.trim() || (files?.length ? '请查看附件' : ''),
              files?.map((file) => file.id),
              parseMentionedAgentsFromEditorData(editorData ?? undefined).map((agent) => agent.id),
            )),
      ),
    onDeleteMessage: (id) => updatePublishedMessage(id, null),
    onUpdateMessageContent: (id, content) => updatePublishedMessage(id, content),
    onStopGenerating: () => {
      void interruptTravelHostAi();
    },
    onRegenerateMessage: async (id) => {
      const message = messages.find(
        (item) =>
          item.id === id ||
          ('executionMessages' in item && item.executionMessages?.some((step) => step.id === id)),
      );
      if (message && 'isGenerating' in message && message.isGenerating) return;
      if (message?.kind === 'assistant') {
        await handoffToTravelHostAi('', undefined, [], message.id);
      } else if (message?.kind === 'self') {
        await handoffToTravelHostAi(
          message.content,
          [...(message.fileList ?? []), ...(message.imageList ?? [])].map((file) => file.id),
          [],
        );
      }
    },
  };

  return {
    conversationHooks,
    accessUnavailable,
    activeTopicId,
    historyTopicId: requestedTopicId,
    assistants,
    aiMaxPromptLength: MEMBER_HOSTED_TRAVEL_AI_MAX_PROMPT_LENGTH,
    aiTaskStatus,
    canInterruptAiTask,
    createTopic,
    draft,
    feedback,
    hasQueryError:
      topicsQuery.isError ||
      Boolean(activeTopicId && (messagesQuery.isError || publishedMessagesQuery.isError)),
    handoffToTravelHostAi,
    interruptTravelHostAi,
    isCreatingTopic,
    isInterruptingAiTask,
    isSending,
    messagesQuery,
    messages,
    publishedMessagesQuery,
    mentionedAgents,
    mentionedAgentIds,
    participantsQuery,
    sendMessage,
    // Viewing history does not change the live send destination.
    setActiveTopicId: (topicId: string, messageId?: string) =>
      router.replace(
        `${GROUP_CHAT_TOPIC_URL(group.groupId, topicId)}${messageId ? `#${encodeURIComponent(messageId)}` : ''}`,
        {
          replace: true,
        },
      ),
    setMentionedAgentIds,
    setDraft,
    setFeedback,
    setTopicTitle,
    topicTitle,
    topics,
    topicsQuery,
  };
};
