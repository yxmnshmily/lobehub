'use client';

import { Flexbox, Skeleton, TextArea } from '@lobehub/ui';
import { Alert, Button, Input, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';

import type { MemberGroupSummary } from '../../_layout/useGroupRouteAccess';
import { useMemberConversation } from './useMemberConversation';

interface MemberConversationProps {
  group: MemberGroupSummary;
  onUnavailable: () => void;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  composer: css`
    padding: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  header: css`
    padding: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  message: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    overflow-wrap: anywhere;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  messageList: css`
    overflow-y: auto;
    margin: 0;
    padding: 16px;
    list-style: none;
  `,
  root: css`
    min-width: 0;
    background: ${cssVar.colorBgContainer};
  `,
  sidebar: css`
    overflow-y: auto;

    width: min(260px, 34vw);
    min-width: 180px;
    padding: 12px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  topicButton: css`
    justify-content: flex-start;
    width: 100%;
  `,
}));

const MemberConversation = ({ group, onUnavailable }: MemberConversationProps) => {
  const {
    accessUnavailable,
    activeTopicId,
    aiMaxCredits,
    aiTaskStatus,
    canInterruptAiTask,
    createTopic,
    draft,
    feedback,
    hasQueryError,
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
  } = useMemberConversation(group, onUnavailable);

  const aiTaskActive =
    aiTaskStatus === 'submitting' || aiTaskStatus === 'queued' || aiTaskStatus === 'running';
  const aiTaskStatusText = {
    completed: '旅游群主AI任务已完成',
    failed: '旅游群主AI任务执行失败',
    idle: undefined,
    interrupted: '旅游群主AI任务已停止',
    queued: '旅游群主AI任务已排队',
    running: '旅游群主AI正在执行任务',
    submitting: '正在交给旅游群主AI…',
  }[aiTaskStatus];

  if (accessUnavailable) return null;

  return (
    <Flexbox horizontal className={styles.root} flex={1} height="100%">
      <Flexbox className={styles.sidebar} gap={12}>
        <Text as="h1" fontSize={20} weight={600}>
          {group.title?.trim() || '默认私人旅游群'}
        </Text>
        <Text type="secondary">真人沟通与旅游群主AI任务分开提交</Text>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createTopic();
          }}
        >
          <Flexbox horizontal gap={8}>
            <Input
              aria-label="新话题标题"
              disabled={isCreatingTopic}
              maxLength={200}
              placeholder="新话题标题"
              value={topicTitle}
              onChange={(event) => setTopicTitle(event.target.value)}
            />
            <Button
              disabled={isCreatingTopic || !topicTitle.trim()}
              htmlType="submit"
              loading={isCreatingTopic}
            >
              新建话题
            </Button>
          </Flexbox>
        </form>

        {topicsQuery.isLoading ? (
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
        ) : (
          <Flexbox aria-label="群聊话题" gap={4} role="navigation">
            {topics.map((topic) => (
              <Button
                aria-current={activeTopicId === topic.id ? 'page' : undefined}
                className={styles.topicButton}
                key={topic.id}
                type={activeTopicId === topic.id ? 'primary' : 'default'}
                onClick={() => {
                  setFeedback(undefined);
                  setActiveTopicId(topic.id);
                }}
              >
                {topic.title?.trim() || '未命名话题'}
              </Button>
            ))}
          </Flexbox>
        )}
      </Flexbox>

      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <Flexbox className={styles.header} gap={4}>
          <Text weight={600}>
            {topics.find((topic) => topic.id === activeTopicId)?.title || '群聊'}
          </Text>
          <Text fontSize={12} type="secondary">
            真人消息不调用AI；只有点击“交给旅游群主AI”才会提交计费任务
          </Text>
          <Text fontSize={12} type="secondary">
            本次AI任务上限 {aiMaxCredits} Credits，实际扣费由服务端结算
          </Text>
        </Flexbox>

        {hasQueryError ? (
          <Flexbox flex={1} padding={16}>
            <Alert
              showIcon
              title="群聊暂时无法读取"
              type="error"
              action={
                <Button
                  onClick={() =>
                    void (topicsQuery.isError ? topicsQuery.refetch() : messagesQuery.refetch())
                  }
                >
                  重试
                </Button>
              }
            />
          </Flexbox>
        ) : messagesQuery.isLoading && activeTopicId ? (
          <Flexbox flex={1} padding={16}>
            <Skeleton active paragraph={{ rows: 4 }} title={false} />
          </Flexbox>
        ) : (
          <Flexbox as="ol" className={styles.messageList} flex={1} gap={8}>
            {(messagesQuery.data?.items ?? []).map((message) => (
              <li className={styles.message} key={message.publicMessageId}>
                {message.content}
              </li>
            ))}
            {activeTopicId && (messagesQuery.data?.items.length ?? 0) === 0 && (
              <Text as="li" type="secondary">
                暂无消息
              </Text>
            )}
            {!activeTopicId && (
              <Text as="li" type="secondary">
                请先新建或选择话题
              </Text>
            )}
          </Flexbox>
        )}

        {feedback && (
          <Flexbox paddingInline={12}>
            <Alert showIcon title={feedback} type="error" />
          </Flexbox>
        )}

        {!feedback && aiTaskStatusText && (
          <Flexbox paddingInline={12}>
            <Alert
              showIcon
              title={aiTaskStatusText}
              action={
                canInterruptAiTask ? (
                  <Button
                    loading={isInterruptingAiTask}
                    onClick={() => void interruptTravelHostAi()}
                  >
                    停止任务
                  </Button>
                  ) : undefined
              }
              type={
                aiTaskStatus === 'completed'
                  ? 'success'
                  : aiTaskStatus === 'failed'
                    ? 'error'
                    : 'info'
              }
            />
          </Flexbox>
        )}

        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <Flexbox horizontal align="end" gap={8}>
            <TextArea
              aria-label="群聊消息"
              disabled={isSending || aiTaskActive || Boolean(hasQueryError)}
              maxLength={8000}
              placeholder="输入纯文本消息"
              rows={3}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (feedback) setFeedback(undefined);
              }}
            />
            <Button
              htmlType="submit"
              loading={isSending}
              type="primary"
              disabled={
                !activeTopicId ||
                !draft.trim() ||
                isSending ||
                aiTaskActive ||
                Boolean(hasQueryError)
              }
            >
              发送消息
            </Button>
            <Button
              htmlType="button"
              loading={aiTaskStatus === 'submitting'}
              disabled={
                !draft.trim() ||
                isSending ||
                aiTaskActive ||
                Boolean(hasQueryError)
              }
              onClick={() => void handoffToTravelHostAi()}
            >
              交给旅游群主AI
            </Button>
          </Flexbox>
        </form>
      </Flexbox>
    </Flexbox>
  );
};

export default MemberConversation;
