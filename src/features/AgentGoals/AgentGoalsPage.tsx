'use client';

import type { GoalStatus } from '@lobechat/const/goal';
import { Block, Empty, Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Checkbox, Segmented, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  CircleCheck,
  Clock3,
  History,
  House,
  LayoutGridIcon,
  ListIcon,
  PlusIcon,
  RefreshCwIcon,
  Target,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GoalSkeleton from '@/components/Skeleton/Goal';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import BulkSelectionBar from '@/features/AgentTopicManager/BulkSelectionBar';
import NavHeader from '@/features/NavHeader';
import { confirmResourceDeletion } from '@/features/ResourceDeletion/confirmResourceDeletion';
import GroupPageBreadcrumb from '@/features/SuperGroup/GroupPageBreadcrumb';
import { useGroupDeletePermission } from '@/features/SuperGroup/useGroupDeletePermission';
import { useGroupWorkHistory } from '@/features/SuperGroup/useGroupWorkHistory';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { goalSelectors, useGoalStore } from '@/store/goal';
import type { GoalListFilter } from '@/store/goal/initialState';

import { createGoalModal } from './CreateGoalModal';
import { GoalCardItem } from './GoalCardItem';
import GoalEmptyState from './GoalEmptyState';
import type { GoalExampleSeed } from './goalExamples';
import { GoalListItem } from './GoalListItem';
import { summarizeGoals } from './goalSummary';

const styles = createStaticStyles(({ css }) => ({
  countBadge: css`
    padding-block: 1px;
    padding-inline: 7px;
    border-radius: 99px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  overview: css`
    padding-block: 6px 18px;
  `,
  list: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;

    @media (width <= 900px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  listRows: css`
    display: flex;
    flex-direction: column;
    border-block: 0.5px solid ${cssVar.colorBorderSecondary};

    & > * + * {
      border-block-start: 0.5px dashed ${cssVar.colorBorder};
    }
  `,
  metric: css`
    min-width: 88px;
    padding-inline-start: 16px;
    border-inline-start: 0.5px solid ${cssVar.colorBorderSecondary};

    &:first-child {
      padding-inline-start: 0;
      border-inline-start: 0;
    }
  `,
}));

/** Goals whose loop has stopped for good — hidden by the default "open" filter. */
const TERMINAL_GOAL_STATUSES = new Set<GoalStatus>(['achieved', 'failed', 'canceled']);

interface AgentGoalsPageProps {
  agentId?: string;
  groupId?: string;
  projectId?: string;
}

const AgentGoalsPage = memo<AgentGoalsPageProps>(({ agentId, groupId, projectId }) => {
  const { t } = useTranslation(['chat', 'common']);
  const { allowed: canEdit } = usePermission('create_content');
  const { canDelete, checkDeletePermission } = useGroupDeletePermission(canEdit, groupId);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const { isHome, toggleView } = useGroupWorkHistory(groupId);
  const navigate = useWorkspaceAwareNavigate();
  const scopeId = groupId ? `group:${groupId}` : projectId ? `project:${projectId}` : agentId!;
  const useFetchGoals = useGoalStore((s) => s.useFetchGoals);
  const refreshGoals = useGoalStore((s) => s.refreshGoals);
  const goals = useGoalStore(goalSelectors.goalList(scopeId));
  const isInitialized = useGoalStore(goalSelectors.isGoalListInitialized(scopeId));
  const filter = useGoalStore((s) => s.goalListFilter);
  const viewMode = useGoalStore((s) => s.goalViewMode);
  const visibleLimit = useGoalStore((s) => s.goalListVisibleLimit);
  const setFilter = useGoalStore((s) => s.setGoalListFilter);
  const setViewMode = useGoalStore((s) => s.setGoalViewMode);
  const loadMoreGoals = useGoalStore((s) => s.loadMoreGoals);
  const { error, isLoading } = useFetchGoals(agentId, projectId, groupId);
  const summary = useMemo(() => summarizeGoals(goals), [goals]);
  const filteredGoals = useMemo(() => {
    if (filter === 'all') return goals;
    if (filter === 'canceled') return goals.filter(({ goal }) => goal.status === 'canceled');

    return goals.filter(({ goal }) => !TERMINAL_GOAL_STATUSES.has(goal.status));
  }, [filter, goals]);
  const selectionScope = `${scopeId}|${filter}|${isHome}`;
  const currentScope = useRef(selectionScope);
  currentScope.current = selectionScope;
  useEffect(() => setSelected([]), [selectionScope]);
  const visibleGoals = filteredGoals.slice(0, visibleLimit);
  const selectedGoals = visibleGoals.filter(({ goal }) => selected.includes(goal.id));
  const toggleGoal = (id: string) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  const confirmDelete = () => {
    if (!canDelete || deleting || !selectedGoals.length) return;
    const targets = [...selectedGoals];
    const scope = selectionScope;
    void confirmResourceDeletion({
      onBusyChange: setDeleting,
      resource: 'goal',
      ids: targets.map(({ goal }) => goal.id),
      canProceed: () => checkDeletePermission() && currentScope.current === scope,

      title: t('bulkDelete.confirmTitle', { ns: 'common', count: targets.length }),

      onOk: (cleanupPending) => {
        if (!checkDeletePermission() || currentScope.current !== scope) return;
        setSelected([]);
        if (!cleanupPending)
          toast.success(t('bulkDelete.success', { ns: 'common', count: targets.length }));
      },
    });
  };
  const visibleGoalCount = filteredGoals.length;
  const GoalItem = viewMode === 'list' ? GoalListItem : GoalCardItem;
  const openCreateGoal = (seed?: GoalExampleSeed) => {
    createGoalModal({
      agentId,
      groupId,
      initialRequirement: seed?.requirement,
      initialRoundBudget: seed?.roundBudget,
      initialTitle: seed?.title,
      projectId,
      // Land the user inside the goal right away: the detail page polls while
      // the goal is still planning, so the exploration graph grows in place
      // instead of the modal blocking on it.
      onCreated: (goal) => {
        void refreshGoals(scopeId);
        const ownerId = goal.agentId ?? agentId;
        navigate(ownerId ? `/agent/${ownerId}/goal/${goal.goalId}` : `/goal/${goal.goalId}`);
      },
    });
  };

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={
          groupId ? (
            <GroupPageBreadcrumb groupId={groupId} title="目标" />
          ) : agentId ? (
            <AgentBreadcrumb agentId={agentId} title={t('goalList.title')} />
          ) : (
            <Text weight={600}>{t('goalList.title')}</Text>
          )
        }
        right={
          <Flexbox horizontal align="center" gap={8}>
            {groupId && (
              <Button
                icon={isHome ? History : House}
                size="small"
                onClick={() => {
                  if (isHome) setFilter('all');
                  toggleView();
                }}
              >
                {isHome ? '历史目标' : '目标首页'}
              </Button>
            )}
            <Button icon={PlusIcon} size={'small'} type={'fill'} onClick={() => openCreateGoal()}>
              {t('goalPage.create')}
            </Button>
          </Flexbox>
        }
      />
      <WideScreenContainer
        fullWidth
        flex={1}
        gap={16}
        paddingBlock={16}
        paddingInline={16}
        wrapperStyle={{ flex: 1, overflowY: 'auto' }}
      >
        {isHome ? (
          <GoalEmptyState hasGoals={goals.length > 0} onCreate={openCreateGoal} />
        ) : isLoading && !isInitialized ? (
          <GoalSkeleton chrome={'body'} />
        ) : error ? (
          <Block padding={32} variant={'outlined'}>
            <Flexbox align={'center'} gap={12}>
              <Text weight={600}>{t('goalList.loadError')}</Text>
              <Text fontSize={13} type={'secondary'}>
                {t('goalList.loadErrorDescription')}
              </Text>
              <Button
                icon={RefreshCwIcon}
                size={'small'}
                onClick={() => void refreshGoals(scopeId)}
              >
                {t('goalList.retry')}
              </Button>
            </Flexbox>
          </Block>
        ) : goals.length === 0 ? (
          groupId ? (
            <Empty title="暂无历史目标" />
          ) : (
            <GoalEmptyState onCreate={openCreateGoal} />
          )
        ) : (
          <>
            <Flexbox className={styles.overview}>
              <Flexbox horizontal align={'center'} gap={20} justify={'space-between'} wrap={'wrap'}>
                <Flexbox gap={3}>
                  <Text fontSize={20} weight={600}>
                    {t('goalPage.title')}
                  </Text>
                  <Text type={'secondary'}>{t('goalPage.description')}</Text>
                </Flexbox>
                <Flexbox horizontal gap={20}>
                  <Flexbox className={styles.metric} gap={2}>
                    <Text fontSize={20} weight={600}>
                      {summary.total}
                    </Text>
                    <Text
                      fontSize={12}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      type={'secondary'}
                    >
                      <Target aria-hidden size={14} />
                      {t('goalPage.metrics.total')}
                    </Text>
                  </Flexbox>
                  <Flexbox className={styles.metric} gap={2}>
                    <Text fontSize={20} weight={600}>
                      {summary.pursuing}
                    </Text>
                    <Text
                      fontSize={12}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      type={'secondary'}
                    >
                      <Clock3 aria-hidden size={14} />
                      {t('goalPage.metrics.pursuing')}
                    </Text>
                  </Flexbox>
                  <Flexbox className={styles.metric} gap={2}>
                    <Text fontSize={20} weight={600}>
                      {summary.delivered}
                    </Text>
                    <Text
                      fontSize={12}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      type={'secondary'}
                    >
                      <CircleCheck aria-hidden size={14} />
                      {t('goalPage.metrics.delivered')}
                    </Text>
                  </Flexbox>
                </Flexbox>
              </Flexbox>
            </Flexbox>
            <Flexbox gap={10}>
              <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Text fontSize={16} weight={600}>
                    {t('goalPage.listTitle')}
                  </Text>
                  <span className={styles.countBadge}>{visibleGoalCount}</span>
                </Flexbox>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Segmented
                    size={'small'}
                    value={filter}
                    options={[
                      {
                        label: t('goalPage.filter.open'),
                        value: 'active',
                      },
                      {
                        label: t('goalPage.filter.all'),
                        value: 'all',
                      },
                      {
                        label: t('goalList.status.canceled'),
                        value: 'canceled',
                      },
                    ]}
                    onChange={(value) => setFilter(value as GoalListFilter)}
                  />
                  <ActionIcon
                    icon={ListIcon}
                    size={'small'}
                    style={{ alignSelf: 'center' }}
                    title={t('goalPage.view.list')}
                    variant={viewMode === 'list' ? 'filled' : 'borderless'}
                    onClick={() => setViewMode('list')}
                  />
                  <ActionIcon
                    icon={LayoutGridIcon}
                    size={'small'}
                    style={{ alignSelf: 'center' }}
                    title={t('goalPage.view.card')}
                    variant={viewMode === 'card' ? 'filled' : 'borderless'}
                    onClick={() => setViewMode('card')}
                  />
                </Flexbox>
              </Flexbox>
              {canDelete && (
                <BulkSelectionBar
                  busy={deleting}
                  selectedCount={selectedGoals.length}
                  total={visibleGoals.length}
                  onClear={() => setSelected([])}
                  onDelete={confirmDelete}
                  onSelectAll={() => setSelected(visibleGoals.map(({ goal }) => goal.id))}
                />
              )}
              <div className={viewMode === 'card' ? styles.list : styles.listRows}>
                {filteredGoals.length === 0 ? (
                  <Block padding={32} variant={'outlined'}>
                    <Empty
                      description={
                        filter === 'canceled' ? undefined : t('goalPage.filteredEmptyDescription')
                      }
                      title={
                        filter === 'canceled' ? '暂无已取消目标' : t('goalPage.filteredEmptyTitle')
                      }
                    />
                  </Block>
                ) : (
                  visibleGoals.map((item) => (
                    <Flexbox
                      horizontal
                      align="center"
                      gap={8}
                      key={item.goal.id}
                      style={{ minWidth: 0 }}
                    >
                      {canDelete && (
                        <Checkbox
                          aria-label={item.goal.title || item.goal.id}
                          checked={selected.includes(item.goal.id)}
                          disabled={deleting}
                          onChange={() => toggleGoal(item.goal.id)}
                        />
                      )}
                      <Flexbox flex={1} style={{ minWidth: 0 }}>
                        <GoalItem goal={item} projectId={projectId} />
                      </Flexbox>
                    </Flexbox>
                  ))
                )}
              </div>
              {visibleLimit < filteredGoals.length && (
                <Flexbox align={'center'} paddingBlock={8}>
                  <Button size={'small'} onClick={loadMoreGoals}>
                    {t('goalPage.loadMore')}
                  </Button>
                </Flexbox>
              )}
            </Flexbox>
          </>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
});

AgentGoalsPage.displayName = 'AgentGoalsPage';

export default AgentGoalsPage;
