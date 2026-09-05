'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';

import type { MemberGroupSummary } from '../../_layout/useGroupRouteAccess';

const MEMBER_HOSTED_TRAVEL_AI_MAX_CREDITS = 1000;
const MEMBER_HOSTED_TRAVEL_AI_POLL_INTERVAL_MS = 2000;
const MEMBER_HOSTED_TRAVEL_AI_POLL_LIMIT = 20;

type HostedTravelAiStatus =
  | 'completed'
  | 'failed'
  | 'idle'
  | 'interrupted'
  | 'queued'
  | 'running'
  | 'submitting';

const isHostedRunStatus = (
  status: unknown,
): status is Exclude<HostedTravelAiStatus, 'idle' | 'submitting'> =>
  status === 'queued' ||
  status === 'running' ||
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
  const [activeTopicId, setActiveTopicId] = useState<string>();
  const [aiTaskStatus, setAiTaskStatus] = useState<HostedTravelAiStatus>('idle');
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<string>();
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);
  const [isInterruptingAiTask, setIsInterruptingAiTask] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [topicTitle, setTopicTitle] = useState('');
  const topicLock = useRef(false);
  const aiTaskLock = useRef(false);
  const hostedRunHandle = useRef<string>();
  const hostedRunGeneration = useRef(0);
  const hostedRunPollTimer = useRef<ReturnType<typeof setTimeout>>();
  const messageLock = useRef(false);

  const topicsQuery = lambdaQuery.groupConversation.listTopics.useQuery(
    { groupId: group.groupId, limit: 50 },
    { gcTime: 0, refetchOnWindowFocus: true, retry: false },
  );
  const messagesQuery = lambdaQuery.groupConversation.listTextMessages.useQuery(
    { groupId: group.groupId, limit: 50, topicId: activeTopicId || '' },
    { enabled: Boolean(activeTopicId), gcTime: 0, refetchOnWindowFocus: true, retry: false },
  );
  const createTopicMutation = lambdaQuery.groupConversation.createTopic.useMutation();
  const createTextMessageMutation = lambdaQuery.groupConversation.createTextMessage.useMutation();
  const startHostedTravelGroupTaskMutation =
    lambdaQuery.aiAgent.startHostedTravelGroupTask.useMutation();
  const interruptHostedTravelGroupRunMutation =
    lambdaQuery.aiAgent.interruptHostedTravelGroupRun.useMutation();

  const topics = useMemo(() => topicsQuery.data?.items ?? [], [topicsQuery.data?.items]);
  const accessUnavailable =
    (topicsQuery.isError && isUnavailableError(topicsQuery.error)) ||
    (messagesQuery.isError && isUnavailableError(messagesQuery.error));
  const canInterruptAiTask = aiTaskStatus === 'queued' || aiTaskStatus === 'running';

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
    clearHostedRun();
    setActiveTopicId(undefined);
    setAiTaskStatus('idle');
    setDraft('');
    setFeedback(undefined);
    setTopicTitle('');
    topicLock.current = false;
    messageLock.current = false;
  }, [clearHostedRun, group.groupId]);

  useEffect(() => () => clearHostedRun(), [clearHostedRun]);

  useEffect(() => {
    if (topics.length === 0) {
      setActiveTopicId(undefined);
      return;
    }
    if (!activeTopicId || !topics.some((topic) => topic.id === activeTopicId)) {
      setActiveTopicId(topics[0].id);
    }
  }, [activeTopicId, topics]);

  useEffect(() => {
    if (!accessUnavailable) return;
    clearHostedRun();
    setActiveTopicId(undefined);
    setAiTaskStatus('idle');
    setDraft('');
    setTopicTitle('');
    onUnavailable();
  }, [accessUnavailable, clearHostedRun, onUnavailable]);

  const createTopic = async () => {
    const title = topicTitle.trim();
    if (!title || topicLock.current) return;

    topicLock.current = true;
    setIsCreatingTopic(true);
    setFeedback(undefined);
    try {
      const created = await createTopicMutation.mutateAsync({
        groupId: group.groupId,
        idempotencyKey: globalThis.crypto.randomUUID(),
        title,
      });
      setTopicTitle('');
      setActiveTopicId(created.id);
      await topicsQuery.refetch();
    } catch (error) {
      if (isUnavailableError(error)) onUnavailable();
      else setFeedback('话题未创建，请重试');
    } finally {
      topicLock.current = false;
      setIsCreatingTopic(false);
    }
  };

  const sendMessage = async () => {
    const content = draft.trim();
    if (!activeTopicId || !content || messageLock.current || aiTaskLock.current) return;

    messageLock.current = true;
    setIsSending(true);
    setFeedback(undefined);
    try {
      await createTextMessageMutation.mutateAsync({
        content,
        groupId: group.groupId,
        idempotencyKey: globalThis.crypto.randomUUID(),
        topicId: activeTopicId,
      });
      setDraft('');
      await messagesQuery.refetch();
    } catch (error) {
      if (isUnavailableError(error)) onUnavailable();
      else setFeedback('消息未发送，请重试');
    } finally {
      messageLock.current = false;
      setIsSending(false);
    }
  };

  const handoffToTravelHostAi = async () => {
    const prompt = draft.trim();
    if (!prompt || aiTaskLock.current || messageLock.current) return;

    aiTaskLock.current = true;
    setAiTaskStatus('submitting');
    setFeedback(undefined);
    const admissionGeneration = hostedRunGeneration.current;
    try {
      const result = await startHostedTravelGroupTaskMutation.mutateAsync({
        billing: {
          idempotencyKey: globalThis.crypto.randomUUID(),
          maxCredits: MEMBER_HOSTED_TRAVEL_AI_MAX_CREDITS,
        },
        groupId: group.groupId,
        prompt,
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
          if (!isHostedRunStatus(safeStatus.status)) {
            throw new Error('INVALID_HOSTED_RUN_STATUS');
          }

          setAiTaskStatus(safeStatus.status);
          if (safeStatus.status === 'completed') {
            clearHostedRun();
            return;
          }
          if (safeStatus.status === 'failed') {
            clearHostedRun();
            setFeedback('任务执行失败，请稍后重试');
            return;
          }
          if (safeStatus.status === 'interrupted') {
            clearHostedRun();
            return;
          }
          if (attempt >= MEMBER_HOSTED_TRAVEL_AI_POLL_LIMIT) {
            setFeedback('任务仍在运行，自动状态更新已暂停');
            return;
          }

          hostedRunPollTimer.current = setTimeout(() => {
            void pollHostedRun(attempt + 1);
          }, MEMBER_HOSTED_TRAVEL_AI_POLL_INTERVAL_MS);
        } catch (error) {
          clearHostedRun();
          setAiTaskStatus('failed');
          if (isUnavailableError(error)) {
            setFeedback('任务状态已不可用');
            onUnavailable();
          } else {
            setFeedback('任务状态暂时无法读取');
          }
        }
      };

      await pollHostedRun(1);
    } catch (error) {
      if (hostedRunGeneration.current !== admissionGeneration) return;
      clearHostedRun();
      setAiTaskStatus('failed');
      if (isUnavailableError(error)) onUnavailable();
      else setFeedback('旅游群主AI未受理，请重试');
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

  return {
    accessUnavailable,
    activeTopicId,
    aiMaxCredits: MEMBER_HOSTED_TRAVEL_AI_MAX_CREDITS,
    aiTaskStatus,
    canInterruptAiTask,
    createTopic,
    draft,
    feedback,
    hasQueryError: topicsQuery.isError || Boolean(activeTopicId && messagesQuery.isError),
    handoffToTravelHostAi,
    interruptTravelHostAi,
    isCreatingTopic,
    isInterruptingAiTask,
    isSending,
    messagesQuery,
    sendMessage,
    setActiveTopicId,
    setDraft,
    setFeedback,
    setTopicTitle,
    topicTitle,
    topics,
    topicsQuery,
  };
};
