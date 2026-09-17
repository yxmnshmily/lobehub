'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, use, useCallback, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import ChatConversation from '@/routes/(main)/agent/features/Conversation';
import ChatHydration from '@/routes/(main)/agent/features/Conversation/ChatHydration';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

import { GroupProjectScopeContext } from '../Layout/GroupProjectScope';
import { getProjectConversationPath } from '../Layout/navigation';
import ProjectAssistantAction from './ProjectAssistantAction';
import ProjectProgress from './ProjectProgress';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    container: project-conversation / inline-size;
  `,
  chat: css`
    --conversation-column-width: 100%;
  `,
  body: css`
    overflow: hidden;
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(280px, 28%, 360px);
    flex: 1;

    min-width: 0;
    min-height: 0;

    @container project-conversation (max-width: 840px) {
      display: flex;
      flex-direction: column-reverse;
    }
  `,
}));

const ProjectConversation = memo(() => {
  const { t } = useTranslation('project');
  const { projectId, topicId } = useParams<{ projectId: string; topicId?: string }>();
  const detail = useCurrentProjectDetail(projectId);
  const detailSWR = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const groupScope = use(GroupProjectScopeContext);
  const navigate = useWorkspaceAwareNavigate();
  const [searchParams] = useSearchParams();
  const { mutate } = detailSWR;
  useEffect(() => {
    if (!projectId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void mutate().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [projectId, mutate]);
  const coordinatorAgentId = detail?.project.coordinatorAgentId;
  const projectSlug = detail?.project.slug ?? projectId;
  const topicsSWR = useChatStore((s) => s.useFetchTopics)(!!coordinatorAgentId, {
    agentId: coordinatorAgentId,
    pageSize: 20,
  });
  const latestTopicId = topicsSWR.data?.items[0]?.id;
  const newConversation = searchParams.get('new') === '1';
  useEffect(() => {
    if (!topicId && !newConversation && latestTopicId && projectSlug)
      navigate(getProjectConversationPath(projectSlug, latestTopicId), { replace: true });
  }, [topicId, newConversation, latestTopicId, projectSlug, navigate]);
  const topicTitle = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.title : undefined,
  );

  useInitAgentConfig(coordinatorAgentId);

  useLayoutEffect(() => {
    if (!coordinatorAgentId) return;

    useAgentStore.setState(
      { activeAgentId: coordinatorAgentId },
      false,
      'ProjectConversation/syncAgentId',
    );
    useChatStore.setState(
      { activeAgentId: coordinatorAgentId },
      false,
      'ProjectConversation/syncAgentId',
    );
  }, [coordinatorAgentId]);

  const getConversationPath = useCallback(
    () => getProjectConversationPath(projectSlug!),
    [projectSlug],
  );
  const getTopicPath = useCallback(
    (_agentId: string, topicId: string) => getProjectConversationPath(projectSlug!, topicId),
    [projectSlug],
  );

  if (
    detailSWR.error &&
    (!detail || ['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND'].includes(detailSWR.error.data?.code))
  ) {
    return <AsyncError error={detailSWR.error} variant="page" onRetry={detailSWR.mutate} />;
  }
  if (detailSWR.isLoading || !detail) {
    return (
      <Center height="100%" width="100%">
        <NeuralNetworkLoading />
      </Center>
    );
  }
  if (!coordinatorAgentId) return <Text>项目缺少协调成员，请先配置项目成员后再开始对话。</Text>;

  return (
    <Flexbox
      className={styles.container}
      flex={1}
      height="100%"
      style={{ minHeight: 0, minWidth: 0 }}
    >
      {!groupScope && (
        <NavHeader
          left={
            <Text ellipsis weight={600}>
              {topicTitle || t('sidebar.newConversation')}
            </Text>
          }
        />
      )}
      <ChatHydration getConversationPath={getConversationPath} getTopicPath={getTopicPath} />
      <div className={styles.body}>
        <Flexbox
          className={styles.chat}
          flex={1}
          height="100%"
          style={{ minHeight: 0, minWidth: 0, overflow: 'hidden' }}
        >
          <Flexbox padding={16} style={{ flexShrink: 0, minWidth: 0 }}>
            <Text ellipsis fontSize={12} type="secondary">
              {topicTitle || '在这里说明需求、补充资料，或反馈修改意见。'}
            </Text>
          </Flexbox>
          <ChatConversation
            inputLeftContent={<ProjectAssistantAction assistantId={coordinatorAgentId} />}
          />
        </Flexbox>
        <ProjectProgress detail={detail} stale={!!detailSWR.error} />
      </div>
    </Flexbox>
  );
});

ProjectConversation.displayName = 'ProjectConversation';

export default ProjectConversation;
