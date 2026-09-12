'use client';

import { GROUP_CHAT_TOPIC_URL, GROUP_CHAT_URL } from '@lobechat/const';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { memo, useLayoutEffect, useRef } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';

import { useClearActiveTopicUnread } from '@/features/Conversation/hooks';
import { useTopicCommentDeepLink } from '@/features/TopicComment/useTopicCommentDeepLink';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useQueryState } from '@/hooks/useQueryParam';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';

const getSearchSuffix = (searchParams: URLSearchParams) => {
  const search = searchParams.toString();

  return search ? `?${search}` : '';
};

// sync outside state to useChatStore
const ChatHydration = memo(() => {
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const params = useParams<{ gid?: string; topicId?: string }>();
  const [searchParams] = useSearchParams();

  const [thread, setThread] = useQueryState('thread', { history: 'replace', throttleMs: 500 });
  const routeTopicId = params.topicId;
  const managed = useAgentGroupStore(
    (s) =>
      !!params.gid && s.groupMap[params.gid]?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  );
  const topics = lambdaQuery.groupConversation.listTopics.useQuery(
    { groupId: params.gid ?? '', limit: 1, recent: true },
    { enabled: managed, refetchOnWindowFocus: false },
  );
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const initializedGroup = useRef<string | undefined>(undefined);
  const managedRef = useRef(managed);
  managedRef.current = managed;
  useLayoutEffect(() => {
    if (!managed) {
      initializedGroup.current = undefined;
      return;
    }
    const viewKey = `${params.gid}:${routeTopicId ?? 'recent'}`;
    if (
      (routeTopicId || topics.data) &&
      (initializedGroup.current !== viewKey || (!activeTopicId && topics.data?.items.length))
    ) {
      initializedGroup.current = viewKey;
      useChatStore.setState(
        { activeTopicId: routeTopicId ?? topics.data?.items[0]?.id ?? null! },
        false,
        'ChatHydration/groupConversation',
      );
    }
  }, [
    managed,
    topics.data,
    activeTopicId,
    params.gid,
    routeTopicId,
    navigate,
    location.search,
    location.hash,
  ]);

  // Route hydration sets activeTopicId directly (below) instead of going through
  // switchTopic, so clear any lingering persisted unread once the topic loads.
  useClearActiveTopicUnread();
  useTopicCommentDeepLink(routeTopicId);

  useLayoutEffect(() => {
    if (managed) return;
    const target = routeTopicId ?? null;
    if (useChatStore.getState().activeTopicId !== target) {
      useChatStore.setState({ activeTopicId: target! }, false, 'ChatHydration/syncTopicFromUrl');
    }
  }, [routeTopicId, managed]);

  useLayoutEffect(() => {
    const target = thread ?? null;
    if (useChatStore.getState().activeThreadId !== target) {
      useChatStore.setState({ activeThreadId: target! }, false, 'ChatHydration/syncThreadFromUrl');
    }
  }, [thread]);

  const locationRef = useRef(location);
  const paramsRef = useRef(params);
  const searchParamsRef = useRef(searchParams);

  locationRef.current = location;
  paramsRef.current = params;
  searchParamsRef.current = searchParams;

  useLayoutEffect(() => {
    const unsubscribeTopic = useChatStore.subscribe(
      (s) => s.activeTopicId,
      (state) => {
        const { gid } = paramsRef.current;

        if (!gid) return;
        // Managed group history is a separate route. A stream changing its write
        // topic must not send the reader back into the live window.
        if (managedRef.current) return;

        const nextSearchParams = new URLSearchParams(searchParamsRef.current);
        nextSearchParams.delete('topic');

        const nextPath =
          state && !managedRef.current ? GROUP_CHAT_TOPIC_URL(gid, state) : GROUP_CHAT_URL(gid);
        const nextUrl = `${nextPath}${getSearchSuffix(nextSearchParams)}${locationRef.current.hash}`;
        const currentUrl = `${locationRef.current.pathname}${locationRef.current.search}${locationRef.current.hash}`;

        if (currentUrl !== nextUrl) {
          navigate(nextUrl, { replace: true });
        }
      },
    );
    const unsubscribeThread = useChatStore.subscribe(
      (s) => s.activeThreadId,
      (state) => {
        setThread(state || null);
      },
    );

    return () => {
      unsubscribeTopic();
      unsubscribeThread();
    };
  }, [navigate, setThread]);

  return null;
});

export default ChatHydration;
