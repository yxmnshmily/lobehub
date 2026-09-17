'use client';

import { Center, ContextMenuTrigger, Empty, Flexbox, Icon, SearchBar, Tooltip } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  Checkbox,
  type DropdownItem,
  DropdownMenu,
  Text,
  toast,
} from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import {
  FolderClosedIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchXIcon,
  TrashIcon,
} from 'lucide-react';
import { memo, use, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import { PROJECT_STATUS_VISUALS, resolveProjectStatus } from '@/components/ExecutionStatus';
import BulkSelectionBar from '@/features/AgentTopicManager/BulkSelectionBar';
import NavHeader from '@/features/NavHeader';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { openCreateProjectModal } from '@/features/Projects/CreateProjectModal';
import ProjectDisabled from '@/features/Projects/ProjectDisabled';
import { confirmResourceDeletion } from '@/features/ResourceDeletion/confirmResourceDeletion';
import RunUsage from '@/features/RunUsage';
import { useGroupDeletePermission } from '@/features/SuperGroup/useGroupDeletePermission';
import TopicCreatorAvatar from '@/features/TopicCreatorAvatar';
import UserAvatar from '@/features/User/UserAvatar';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useCurrentProjectList, useProjectStore } from '@/store/project';
import type { ProjectListItem } from '@/store/project/store';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, userProfileSelectors } from '@/store/user/selectors';

import { GroupProjectScopeContext } from '../Layout/GroupProjectScope';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    flex: none;
    opacity: 0;
    transition: opacity ${cssVar.motionDurationFast};

    @media (hover: none) {
      opacity: 1;
    }
  `,
  identifier: css`
    flex: none;
    min-width: 72px;
    color: ${cssVar.colorTextSecondary};

    @container project-list (max-width: 600px) {
      display: none;
    }
  `,
  usage: css`
    display: flex;
    flex: none;
    justify-content: flex-end;
    width: 210px;
  `,
  name: css`
    flex: 1;
    min-width: 0;

    @container project-list (max-width: 600px) {
      flex-basis: calc(100% - 32px);
    }
  `,
  link: css`
    display: flex;
    flex: 1;
    gap: 8px;
    align-items: center;

    min-width: 0;

    color: inherit;

    @container project-list (max-width: 600px) {
      flex-wrap: wrap;
    }
  `,
  owner: css`
    flex: none;
    width: 32px;
  `,
  row: css`
    min-height: 56px;
    padding: 12px;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusSM};

    color: inherit;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:hover .project-row-actions,
    &:focus-within .project-row-actions {
      opacity: 1;
    }
  `,
  updatedAt: css`
    flex: none;

    min-width: 88px;

    color: ${cssVar.colorTextSecondary};
    text-align: end;
    white-space: nowrap;

    @container project-list (max-width: 440px) {
      display: none;
    }
  `,
  content: css`
    container: project-list / inline-size;
    min-width: 0;
  `,
  header: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    @container project-list (max-width: 600px) {
      display: none;
    }
  `,
}));

const ProjectOwnerAvatar = memo<{ userId: string }>(({ userId }) => {
  const activeWorkspaceId = useActiveWorkspaceId();

  return (
    <span className={styles.owner}>
      {activeWorkspaceId ? (
        <TopicCreatorAvatar size={20} userId={userId} />
      ) : (
        <UserAvatar size={20} />
      )}
    </span>
  );
});

ProjectOwnerAvatar.displayName = 'ProjectOwnerAvatar';

const ProjectRow = memo<{
  project: ProjectListItem;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
}>(({ project, selected, busy, onSelect }) => {
  const { t } = useTranslation(['project', 'common']);
  const [deleting, setDeleting] = useState(false);
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const { canDelete, checkDeletePermission } = useGroupDeletePermission(
    currentUserId === project.userId,
  );
  const status = resolveProjectStatus(project.status);
  const statusVisual = PROJECT_STATUS_VISUALS[status];

  const handleDelete = (cleanupPending: boolean) => {
    if (checkDeletePermission() && !cleanupPending)
      toast.success(t('list.deleteSuccess', { name: project.name }));
  };

  const menuItems: DropdownItem[] = [
    {
      danger: true,
      icon: <Icon icon={TrashIcon} />,
      key: 'delete',
      label: t('list.deleteAction'),
      onClick: () => {
        void confirmResourceDeletion({
          onBusyChange: setDeleting,
          resource: 'project',
          ids: [project.id],
          canProceed: checkDeletePermission,

          onOk: handleDelete,
          title: t('list.deleteConfirmTitle'),
        });
      },
    },
  ];

  const row = (
    <Flexbox horizontal align={'center'} className={styles.row} gap={8}>
      {canDelete && (
        <Checkbox
          aria-label={project.name}
          checked={selected}
          disabled={!canDelete || busy || deleting}
          onChange={onSelect}
        />
      )}
      <WorkspaceLink className={styles.link} to={`/project/${project.slug ?? project.id}`}>
        <Tooltip title={t(`acceptance.status.${status}`)}>
          <Icon color={statusVisual.color} icon={statusVisual.icon} size={16} />
        </Tooltip>
        <Flexbox className={styles.name}>
          <Text ellipsis weight={500}>
            {project.name}
          </Text>
        </Flexbox>
        <Text className={styles.identifier} fontSize={12}>
          {project.identifier}
        </Text>
        <span className={styles.usage}>
          <RunUsage cost={project.totalRunCost} duration={project.totalRunDuration} />
        </span>
        <ProjectOwnerAvatar userId={project.userId} />
        <Text
          className={styles.updatedAt}
          fontSize={12}
          title={dayjs(project.updatedAt).format('YYYY-MM-DD HH:mm')}
        >
          {dayjs(project.updatedAt).fromNow()}
        </Text>
      </WorkspaceLink>
      <span className={`${styles.actions} project-row-actions`} style={{ width: 28 }}>
        {canDelete && (
          <DropdownMenu items={menuItems} placement={'bottomRight'}>
            <ActionIcon
              icon={MoreHorizontalIcon}
              loading={deleting}
              size={'small'}
              title={t('list.moreActions')}
            />
          </DropdownMenu>
        )}
      </span>
    </Flexbox>
  );

  return canDelete ? <ContextMenuTrigger items={menuItems}>{row}</ContextMenuTrigger> : row;
});

ProjectRow.displayName = 'ProjectRow';

const ProjectListPage = memo(() => {
  const { t } = useTranslation(['project', 'common']);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const activeWorkspaceId = useActiveWorkspaceId();
  const [keyword, setKeyword] = useState('');
  const groupScope = use(GroupProjectScopeContext);
  const { canDelete: canDeleteInGroup, checkDeletePermission } = useGroupDeletePermission(
    true,
    groupScope?.groupId,
  );
  const labEnabled = useUserStore(labPreferSelectors.enableProjects);
  const enabled = labEnabled || !!groupScope;
  const navigate = useWorkspaceAwareNavigate();
  const projects = useCurrentProjectList();
  const { error, isLoading, mutate } = useProjectStore((s) => s.useFetchProjectList)(enabled);

  const filteredProjects = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
    return normalizedKeyword
      ? projects.filter((project) =>
          [project.name, project.identifier, project.description]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(normalizedKeyword)),
        )
      : projects;
  }, [keyword, projects]);

  const selectionScope = JSON.stringify([
    groupScope?.groupId,
    activeWorkspaceId,
    currentUserId,
    keyword,
  ]);
  const currentScope = useRef(selectionScope);
  currentScope.current = selectionScope;
  useEffect(() => setSelected([]), [selectionScope]);
  const selectableProjects = filteredProjects.filter(
    (project) => canDeleteInGroup && project.userId === currentUserId,
  );
  const selectedProjects = selectableProjects.filter((project) => selected.includes(project.id));
  const confirmDelete = () => {
    if (deleting || !selectedProjects.length) return;
    const targets = [...selectedProjects];
    const scope = selectionScope;
    void confirmResourceDeletion({
      onBusyChange: setDeleting,
      resource: 'project',
      ids: targets.map((project) => project.id),
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

  if (!enabled) return <ProjectDisabled />;

  return (
    <Flexbox flex={1} height={'100%'} style={{ minWidth: 0, minHeight: 0 }}>
      {!groupScope && (
        <NavHeader
          left={
            <Text style={{ paddingInlineStart: 4 }} weight={500}>
              {t('list.title')}
            </Text>
          }
        />
      )}
      <WideScreenContainer
        fullWidth
        className={styles.content}
        gap={16}
        paddingBlock={16}
        paddingInline="clamp(12px, 2vw, 24px)"
        wrapperStyle={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <SearchBar
            allowClear
            placeholder={t('list.searchPlaceholder')}
            style={{ maxWidth: 360, flex: 1, minWidth: 0 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Button
            icon={PlusIcon}
            onClick={() =>
              openCreateProjectModal({
                onCreated: (project) =>
                  navigate(`/project/${project.slug ?? project.id}/conversation`),
              })
            }
          >
            {t('create.action')}
          </Button>
        </Flexbox>
        {canDeleteInGroup && (
          <BulkSelectionBar
            busy={deleting}
            selectedCount={selectedProjects.length}
            total={selectableProjects.length}
            onClear={() => setSelected([])}
            onDelete={confirmDelete}
            onSelectAll={() => setSelected(selectableProjects.map((project) => project.id))}
          />
        )}
        {error ? (
          <AsyncError error={error} onRetry={() => mutate()} />
        ) : isLoading && projects.length === 0 ? (
          <SkeletonList rows={8} />
        ) : filteredProjects.length === 0 ? (
          <Center flex={1} padding={48}>
            <Empty
              description={keyword.trim() ? t('list.searchEmpty') : t('list.emptyDescription')}
              icon={keyword.trim() ? SearchXIcon : FolderClosedIcon}
            />
          </Center>
        ) : (
          <Flexbox gap={0}>
            <Flexbox aria-hidden horizontal align="center" className={styles.header} gap={8}>
              <span style={{ width: 20, flex: 'none' }} />
              <span style={{ flex: 1 }}>项目名称</span>
              <span className={styles.identifier}>编号</span>
              <span className={styles.usage}>{t('runUsage.summary', { ns: 'common' })}</span>
              <span className={styles.owner}>成员</span>
              <span className={styles.updatedAt}>更新时间</span>
              <span style={{ width: 28, flex: 'none' }} />
            </Flexbox>
            {filteredProjects.map((project) => (
              <ProjectRow
                busy={deleting}
                key={project.id}
                project={project}
                selected={selected.includes(project.id)}
                onSelect={() =>
                  setSelected((ids) =>
                    ids.includes(project.id)
                      ? ids.filter((id) => id !== project.id)
                      : [...ids, project.id],
                  )
                }
              />
            ))}
          </Flexbox>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
});

ProjectListPage.displayName = 'ProjectListPage';

export default ProjectListPage;
