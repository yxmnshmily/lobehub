'use client';

import { Flexbox, Markdown } from '@lobehub/ui';
import { Alert, Button, Text } from '@lobehub/ui/base-ui';
import { useMemo, useState } from 'react';

import InterventionContent from '@/features/Conversation/InterventionBar/InterventionContent';
import MessageItem from '@/features/Conversation/Messages';
import {
  deriveOperationGoals,
  type OperationGoal,
} from '@/features/Conversation/Messages/GoalTaskCard/deriveOperationGoals';
import GoalStatusLine from '@/features/Conversation/Messages/GoalTaskCard/GoalStatusLine';
import { getGoalTaskProgress } from '@/features/Conversation/Messages/GoalTaskCard/goalTaskProgress';
import { dataSelectors, useConversationStore } from '@/features/Conversation/store';
import { useGoalStore } from '@/store/goal';
import { useTravelTranslation } from '@/utils/i18n/travel';

import { collectGroupWorkEntries, getGroupWorkKind, type GroupWorkKind } from './groupWorkEntries';

function GoalProgress({ goal }: { goal: OperationGoal }) {
  const t = useTravelTranslation();
  const fetchGraph = useGoalStore((s) => s.useFetchGoalGraph);
  const { data, error, mutate } = fetchGraph(goal.goalId);
  if (error)
    return (
      <Alert
        action={<Button onClick={() => void mutate()}>{t('重试')}</Button>}
        title={t('目标进度暂不可用，可能已删除或没有查看权限。')}
        type="error"
      />
    );
  if (!data) return <Text>{t('正在读取目标进度…')}</Text>;
  const nodes = data.nodes.filter((node) => node.kind === 'task');
  const progress = getGoalTaskProgress({
    criteriaCount: goal.criteriaCount,
    status: data.goal.status,
    pendingDecisions: data.decisions.filter((decision) => decision.status === 'pending').length,
    taskDone: nodes.filter((node) => ['rejected', 'resolved', 'retired'].includes(node.status))
      .length,
    taskTotal: nodes.length,
  });
  return (
    <Flexbox gap={8}>
      <Text weight={600}>{data.goal.title}</Text>
      <GoalStatusLine {...progress} />
      {data.goal.requirement && <Markdown>{data.goal.requirement}</Markdown>}
    </Flexbox>
  );
}

export default function GroupWorkPanelContent({
  initialKind,
  onAdd,
}: {
  initialKind: GroupWorkKind;
  onAdd?: (kind: GroupWorkKind) => void;
}) {
  const t = useTravelTranslation();
  const [kind, setKind] = useState(initialKind);
  const messages = useConversationStore(dataSelectors.displayMessages);
  const messagesInit = useConversationStore(dataSelectors.messagesInit);
  const pending = useConversationStore(dataSelectors.pendingInterventions);
  const entries = useMemo(() => collectGroupWorkEntries(messages), [messages]);
  const approvals = pending.filter((item) => getGroupWorkKind(item) === kind);

  return (
    <Flexbox gap={16} style={{ minWidth: 0 }}>
      <Flexbox horizontal aria-label={t('查看分类')} gap={8} role="group" wrap="wrap">
        <Button aria-pressed={kind === 'goals'} onClick={() => setKind('goals')}>
          {t('目标')}
        </Button>
        <Button aria-pressed={kind === 'tasks'} onClick={() => setKind('tasks')}>
          {t('任务')}
        </Button>
        {onAdd && (
          <Button style={{ marginInlineStart: 'auto' }} onClick={() => onAdd(kind)}>
            {kind === 'goals' ? t('添加目标') : t('添加任务')}
          </Button>
        )}
      </Flexbox>
      <Text type="secondary">
        {t(
          '仅显示当前群已加载聊天记录中的目标与任务；未加载的话题不在列表中。查看不会启动或取消工作。',
        )}
      </Text>
      {!messagesInit ? (
        <Text>{t('正在加载…')}</Text>
      ) : entries[kind].length === 0 ? (
        <Text>{kind === 'goals' ? t('当前话题暂无目标记录') : t('当前话题暂无任务记录')}</Text>
      ) : null}
      {approvals.map((item) => (
        <section aria-label={t('等待确认分工')} key={item.toolCallId}>
          <Text weight={600}>{t('等待确认分工')}</Text>
          <InterventionContent actionsPortalTarget={null} intervention={item} />
        </section>
      ))}
      {entries[kind].map((message, index) => {
        if (approvals.some((item) => item.toolMessageId === message.id)) return null;
        const blocks =
          message.role === 'tool' && message.plugin
            ? [
                {
                  id: message.id,
                  tools: [
                    {
                      ...message.plugin,
                      id: message.tool_call_id || message.id,
                      arguments: message.plugin.arguments || '{}',
                      result: {
                        id: message.id,
                        content: message.content,
                        state: message.pluginState,
                        error: message.error,
                      },
                    },
                  ],
                },
              ]
            : message.children;
        const goals = kind === 'goals' ? deriveOperationGoals(blocks) : [];
        if (
          (message.role === 'tool' && goals.length === 0) ||
          (kind === 'tasks' && ['task', 'tasks', 'groupTasks'].includes(message.role))
        )
          return (
            <MessageItem disableEditing readOnly id={message.id} index={index} key={message.id} />
          );
        const dialogue =
          message.children
            ?.map((block) => block.content)
            .filter(Boolean)
            .join('\n\n') || (message.role !== 'tool' ? message.content : '');
        return (
          <Flexbox gap={12} key={message.id}>
            {goals.map((goal) => (
              <GoalProgress goal={goal} key={goal.goalId} />
            ))}
            {dialogue && (
              <details>
                <summary>{t('查看相关群聊对话')}</summary>
                <Markdown>{dialogue}</Markdown>
              </details>
            )}
          </Flexbox>
        );
      })}
    </Flexbox>
  );
}
