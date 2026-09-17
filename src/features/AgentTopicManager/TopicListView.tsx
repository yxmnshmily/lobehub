'use client';

import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import type { GroupedTopic } from '@lobechat/types';
import { DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Checkbox, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  CircleDot,
  Clock3,
  Coins,
  FolderIcon,
  MessageSquare,
  MoreHorizontal,
  Star,
  Type,
} from 'lucide-react';
import { Fragment, type KeyboardEvent, memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useTopicItemDropdownMenu } from '@/features/AgentSidebar/Topic/List/Item/useDropdownMenu';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getPlatformIcon } from '@/routes/(main)/agent/channel/const';
import type { ChatTopic } from '@/types/topic';

import StatusDot from './StatusDot';
import { useTopicsViewStore } from './store';
import { TopicAssociations, TopicCredits } from './TopicBusinessInfo';
import type { GroupBy, TriggerFilter } from './types';
import { getProjectGroupTitle, getProjectLabel, getTimeGroupTitle } from './utils';

const KNOWN_TRIGGERS: readonly TriggerFilter[] = ['chat', 'api', 'task', 'eval'];

const styles = createStaticStyles(({ css }) => ({
  cell: css`
    overflow: hidden;
    min-width: 0;
  `,
  checkboxBox: css`
    border-color: ${cssVar.colorBorder};
  `,
  groupBar: css`
    display: flex;
    gap: 6px;
    align-items: baseline;

    padding-block: 8px;
    padding-inline: 16px;
    border-block-end: 0.5px solid ${cssVar.colorSplit};

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  groupCount: css`
    font-size: 11px;
    font-weight: 400;
    color: ${cssVar.colorTextQuaternary};
  `,
  header: css`
    position: sticky;
    z-index: 2;
    inset-block-start: 0;

    display: grid;
    grid-template-columns: 24px minmax(180px, 1fr) 160px 64px 54px 100px 90px 24px;
    gap: 12px;
    align-items: center;

    min-width: 850px;
    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 0.5px solid ${cssVar.colorSplit};

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    /* opaque so scrolled rows don't bleed through */
    background: ${cssVar.colorBgElevated};

    @media (width <= 479.98px) {
      grid-template-columns: 24px minmax(0, 1fr) max-content 32px;
      gap: 8px;
      min-width: 0;
      padding-inline: 12px;
    }
  `,
  headerCell: css`
    display: flex;
    gap: 6px;
    align-items: center;
    white-space: nowrap;
  `,
  headerCellEnd: css`
    justify-content: flex-end;
  `,
  list: css`
    position: relative;

    overflow: auto;

    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
  `,
  mobileNoActions: css`
    @media (width <= 479.98px) {
      && {
        grid-template-columns: 24px minmax(0, 1fr) max-content;
      }
    }
  `,
  mobileReadOnly: css`
    @media (width <= 479.98px) {
      && {
        grid-template-columns: minmax(0, 1fr) max-content 32px;
      }
    }
  `,
  mobileReadOnlyNoActions: css`
    @media (width <= 479.98px) {
      && {
        grid-template-columns: minmax(0, 1fr) max-content;
      }
    }
  `,
  row: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 24px minmax(180px, 1fr) 160px 64px 54px 100px 90px 24px;
    gap: 12px;
    align-items: center;

    min-width: 850px;
    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 0.5px solid ${cssVar.colorSplit};

    transition: background 0.12s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }

    &:last-child {
      border-block-end: none;
    }

    @media (width <= 479.98px) {
      grid-template-columns: 24px minmax(0, 1fr) max-content 32px;
      gap: 8px;
      min-width: 0;
      padding-inline: 12px;
    }
  `,
  rowSelected: css`
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      background: ${cssVar.colorPrimaryBgHover};
    }
  `,
  sub: css`
    overflow: hidden;
    margin-block-start: 2px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface TopicListViewProps {
  agentId: string;
  groupBy: GroupBy;
  groups: GroupedTopic[];
  onOpen?: (topicId: string) => void;
  readOnly?: boolean;
  showGroupTitles: boolean;
}

interface RowProps {
  agentId: string;
  mobile?: boolean;
  onOpen?: (topicId: string) => void;
  readOnly?: boolean;
  topic: ChatTopic;
}

const Row = memo<RowProps>(({ topic, agentId, mobile, onOpen, readOnly = !!onOpen }) => {
  const { t } = useTranslation('topic');
  const navigate = useWorkspaceAwareNavigate();

  const selectMode = useTopicsViewStore((s) => s.selectMode);
  const selected = useTopicsViewStore((s) => s.selectedIds.includes(topic.id));
  const toggleSelected = useTopicsViewStore((s) => s.toggleSelected);
  const toggleSelectMode = useTopicsViewStore((s) => s.toggleSelectMode);

  const { dropdownMenu } = useTopicItemDropdownMenu({
    fav: topic.favorite,
    id: topic.id,
    status: topic.status,
    title: topic.title,
  });

  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (!readOnly && (selectMode || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleSelected(topic.id);
        return;
      }
      if (onOpen) {
        onOpen(topic.id);
        return;
      }
      navigate(AGENT_CHAT_TOPIC_URL(agentId, topic.id));
    },
    [selectMode, topic.id, agentId, toggleSelected, navigate, onOpen, readOnly],
  );

  const handleCheckboxChange = useCallback(() => {
    if (!selectMode) toggleSelectMode();
    toggleSelected(topic.id);
  }, [selectMode, topic.id, toggleSelected, toggleSelectMode]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget || e.key !== 'Enter') return;

      e.preventDefault();
      if (!readOnly && selectMode) {
        toggleSelected(topic.id);
        return;
      }
      if (onOpen) {
        onOpen(topic.id);
        return;
      }
      navigate(AGENT_CHAT_TOPIC_URL(agentId, topic.id));
    },
    [agentId, navigate, onOpen, readOnly, selectMode, toggleSelected, topic.id],
  );

  const status = topic.status ?? 'active';
  const projectLabel = getProjectLabel(topic);
  const updatedAt = useActivityTime(topic.updatedAt);
  const rawTrigger = topic.trigger ?? 'chat';
  const triggerKey: TriggerFilter = (KNOWN_TRIGGERS as readonly string[]).includes(rawTrigger)
    ? (rawTrigger as TriggerFilter)
    : 'chat';
  const triggerLabel = t(`management.filters.trigger.${triggerKey}` as any) as string;
  // Bot source platform icon (same identity mark as the sidebar topic item).
  const botPlatform = topic.metadata?.bot?.platform;
  const BotPlatformIcon = botPlatform ? getPlatformIcon(botPlatform) : undefined;

  return (
    <div
      aria-label={topic.title || t('defaultTitle')}
      role="link"
      tabIndex={0}
      className={[
        styles.row,
        selected && styles.rowSelected,
        mobile && onOpen && !readOnly && styles.mobileNoActions,
        mobile && !onOpen && readOnly && styles.mobileReadOnly,
        mobile && onOpen && readOnly && styles.mobileReadOnlyNoActions,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {(!mobile || !readOnly) && (
        <div onClick={(e) => e.stopPropagation()}>
          {!readOnly && (
            <Checkbox
              aria-label={topic.title || t('defaultTitle')}
              checked={selected}
              classNames={{ checkbox: styles.checkboxBox }}
              size={18}
              onChange={handleCheckboxChange}
            />
          )}
        </div>
      )}
      <div className={styles.cell}>
        <Flexbox horizontal align={'center'} gap={6}>
          {topic.favorite && (
            <Icon icon={Star} size={12} style={{ color: cssVar.colorWarning, flexShrink: 0 }} />
          )}
          {BotPlatformIcon && (
            <BotPlatformIcon
              color={cssVar.colorTextDescription}
              size={13}
              style={{ flexShrink: 0 }}
            />
          )}
          <Text className={styles.title} fontSize={13} weight={500}>
            {topic.title || t('defaultTitle')}
          </Text>
        </Flexbox>
        {mobile && topic.businessAssociations !== undefined && (
          <Flexbox gap={4} style={{ fontSize: 11, color: cssVar.colorTextTertiary, minWidth: 0 }}>
            <TopicAssociations topic={topic} />
            <span>
              {t('management.columns.credits')}：<TopicCredits topic={topic} />
            </span>
          </Flexbox>
        )}
        {topic.historySummary && (
          <Text className={styles.sub} fontSize={11} type={'secondary'}>
            {topic.historySummary}
          </Text>
        )}
      </div>
      {!mobile && (
        <div className={styles.cell}>
          {topic.businessAssociations !== undefined ? (
            <TopicAssociations topic={topic} />
          ) : projectLabel ? (
            <Tag icon={<Icon icon={FolderIcon} size={11} />} size={'small'}>
              {projectLabel}
            </Tag>
          ) : (
            <Text fontSize={12} type={'secondary'}>
              —
            </Text>
          )}
        </div>
      )}
      <StatusDot status={status} />
      {!mobile && (
        <>
          <Text fontSize={12} type={'secondary'}>
            {triggerLabel}
          </Text>
          <Text
            fontSize={12}
            style={{ color: cssVar.colorTextQuaternary, textAlign: 'end' }}
            title={updatedAt.title}
          >
            {updatedAt.text}
          </Text>
          <Text fontSize={12} style={{ color: cssVar.colorTextTertiary, textAlign: 'end' }}>
            <TopicCredits topic={topic} />
          </Text>
        </>
      )}
      {!onOpen && (
        <DropdownMenu items={dropdownMenu}>
          <ActionIcon icon={MoreHorizontal} size={'small'} onClick={(e) => e.stopPropagation()} />
        </DropdownMenu>
      )}
    </div>
  );
});

Row.displayName = 'AgentTopicManagerRow';

const TopicListView = memo<TopicListViewProps>(
  ({ groups, agentId, showGroupTitles, groupBy, onOpen, readOnly = !!onOpen }) => {
    const { t } = useTranslation('topic');
    const mobile = useIsMobile();

    const selectedIds = useTopicsViewStore((s) => s.selectedIds);
    const selectMode = useTopicsViewStore((s) => s.selectMode);
    const selectAll = useTopicsViewStore((s) => s.selectAll);
    const clearSelected = useTopicsViewStore((s) => s.clearSelected);
    const toggleSelectMode = useTopicsViewStore((s) => s.toggleSelectMode);

    const firstGroup = groups.find((group) => group.children.length > 0);
    const allIds = groups.flatMap((g) => g.children.map((c) => c.id));
    const selectedSet = new Set(selectedIds);
    const selectedInListCount = allIds.reduce((acc, id) => acc + (selectedSet.has(id) ? 1 : 0), 0);
    const allSelected = allIds.length > 0 && selectedInListCount === allIds.length;
    const someSelected = selectedInListCount > 0 && !allSelected;

    const handleSelectAll = () => {
      if (allSelected) {
        clearSelected();
      } else {
        if (!selectMode) toggleSelectMode();
        selectAll(allIds);
      }
    };

    return (
      <div className={styles.list}>
        <div
          className={[
            styles.header,
            mobile && onOpen && !readOnly && styles.mobileNoActions,
            mobile && !onOpen && readOnly && styles.mobileReadOnly,
            mobile && onOpen && readOnly && styles.mobileReadOnlyNoActions,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {(!mobile || !readOnly) && (
            <span>
              {!readOnly && (
                <Checkbox
                  aria-label={t('management.bulk.selectAll', { defaultValue: '全选话题' })}
                  checked={allSelected}
                  classNames={{ checkbox: styles.checkboxBox }}
                  indeterminate={someSelected}
                  size={18}
                  onChange={handleSelectAll}
                />
              )}
            </span>
          )}
          <span className={styles.headerCell}>
            <Icon aria-hidden icon={Type} size={14} />
            {t('management.columns.title')}
            {showGroupTitles && firstGroup && (
              <span className={styles.groupCount} style={{ marginInlineStart: 12 }}>
                {groupBy === 'byProject'
                  ? getProjectGroupTitle(firstGroup.id, firstGroup.title, t)
                  : firstGroup.title || getTimeGroupTitle(firstGroup.id, t)}{' '}
                {firstGroup.children.length}
              </span>
            )}
          </span>
          {!mobile && (
            <span className={styles.headerCell}>
              <Icon aria-hidden icon={FolderIcon} size={14} />
              {t(
                onOpen ||
                  groups.some((group) =>
                    group.children.some((topic) => topic.businessAssociations !== undefined),
                  )
                  ? 'management.columns.association'
                  : 'management.columns.project',
              )}
            </span>
          )}
          <span className={styles.headerCell}>
            <Icon aria-hidden icon={CircleDot} size={14} />
            {t('management.columns.status')}
          </span>
          {!mobile && (
            <>
              <span className={styles.headerCell}>
                <Icon aria-hidden icon={MessageSquare} size={14} />
                {t('management.columns.trigger')}
              </span>
              <span className={`${styles.headerCell} ${styles.headerCellEnd}`}>
                <Icon aria-hidden icon={Clock3} size={14} />
                {t('management.columns.updated')}
              </span>
              <span className={`${styles.headerCell} ${styles.headerCellEnd}`}>
                <Icon aria-hidden icon={Coins} size={14} />
                {t('management.columns.credits')}
              </span>
            </>
          )}
          {!onOpen && <span />}
        </div>
        {groups.map((group) => {
          if (group.children.length === 0) return null;
          const title =
            groupBy === 'byProject'
              ? getProjectGroupTitle(group.id, group.title, t)
              : group.title || getTimeGroupTitle(group.id, t);
          return (
            <Fragment key={group.id}>
              {showGroupTitles && group !== firstGroup && (
                <div className={styles.groupBar}>
                  <span>{title}</span>
                  <span className={styles.groupCount}>{group.children.length}</span>
                </div>
              )}
              {group.children.map((topic) => (
                <Row
                  agentId={agentId}
                  key={topic.id}
                  mobile={mobile}
                  readOnly={readOnly}
                  topic={topic}
                  onOpen={onOpen}
                />
              ))}
            </Fragment>
          );
        })}
      </div>
    );
  },
);

TopicListView.displayName = 'AgentTopicManagerListView';

export default TopicListView;
