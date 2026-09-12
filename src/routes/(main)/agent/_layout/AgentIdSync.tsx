import { useEffect } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';

import { resolvePersonalInboxRedirect } from '@/features/AgentRoute/personalInbox';
import { usePersonalInbox } from '@/features/AgentRoute/usePersonalInbox';
import { useResolvedAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';

import { useAgentIdStoreSync } from './useAgentIdStoreSync';

const AgentIdSync = () => {
  const params = useParams<{ aid?: string; topicId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useWorkspaceAwareNavigate();
  const location = useLocation();
  const { agentId: activeId, isSlugRoute, resolvedAgentId } = useResolvedAgentRouteId(params.aid);

  const personalInbox = usePersonalInbox(activeId);

  // Hydrate from the route-owning component. Parent layouts can retain stale
  // params while sibling navigation changes the active agent, which leaves
  // agents absent from the regular sidebar list (for example project
  // coordinators) without a config and renders an empty conversation.
  useInitAgentConfig(activeId);

  // Redirect slug URL to real agent ID URL, preserving child path and query string
  useEffect(() => {
    const inboxRedirect = resolvePersonalInboxRedirect({
      agentId: params.aid,
      personalInbox,
      pathname: location.pathname,
      search: location.search,
    });
    if (inboxRedirect) {
      navigate(inboxRedirect, { replace: true });
      return;
    }
    if (isSlugRoute && resolvedAgentId) {
      const suffix = location.pathname.replace(`/agent/${params.aid}`, '');
      const qs = searchParams.toString();
      navigate(`/agent/${resolvedAgentId}${suffix}${qs ? `?${qs}` : ''}`, { replace: true });
    }
  }, [
    isSlugRoute,
    resolvedAgentId,
    navigate,
    searchParams,
    location.pathname,
    location.search,
    params.aid,
    personalInbox,
  ]);

  useAgentIdStoreSync({
    activeId,
    topicFromPath: params.topicId,
    topicFromQuery: searchParams.get('topic'),
  });

  return null;
};

export default AgentIdSync;
