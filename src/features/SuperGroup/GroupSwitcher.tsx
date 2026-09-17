'use client';

import { GROUP_CHAT_URL } from '@lobechat/const';
import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Avatar, Button, Popover, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDown, ChevronRight, UsersRound } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { usePrefetchGroup } from '@/hooks/usePrefetchGroup';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import CompactListButton from './CompactListButton';
import GroupSidebarSections from './GroupSidebarSections';
import PendingGroupInvitationNotice from './PendingGroupInvitationNotice';

const styles = createStaticStyles(({ css, cssVar }) => ({
  popup: css`
    overflow: hidden;
    width: max-content;

    /* 自适应：内容多宽就多宽，窄窗口保底 300，宽窗口最多长到 440 */
    max-width: min(max(300px, 36vw), 440px, var(--available-width));
  `,
  children: css`
    --group-nav-row-height: 36px;
    --group-nav-gap: 4px;
    --group-branch-center: calc(var(--group-nav-row-height) / 2);

    position: relative;

    box-sizing: border-box;
    width: calc(100% - 8px);
    min-width: 0;
    margin-inline-start: 8px;
    padding-block-start: 4px;
    padding-inline-start: 8px;

    &::before {
      pointer-events: none;
      content: '';

      position: absolute;
      inset-block: 0 var(--group-branch-center);
      inset-inline-start: 0;

      border-inline-start: 0.5px solid ${cssVar.colorBorderSecondary};
    }

    [data-group-nav-branch] {
      position: relative;
      min-width: 0;

      &::before {
        pointer-events: none;
        content: '';

        position: absolute;
        inset-block-start: var(--group-branch-center, 22px);
        inset-inline-start: -8px;

        width: 8px;
        border-block-start: 0.5px solid ${cssVar.colorBorderSecondary};
      }
    }

    @media (pointer: coarse) {
      --group-nav-row-height: 44px;
    }
  `,
  link: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    min-width: 0;
    min-height: 36px;
    padding-block: 4px;
    padding-inline: var(--group-nav-row-inset, 8px);
    padding-inline-end: 40px;
    border: 0;
    border-radius: 8px;

    font: inherit;
    color: ${cssVar.colorText};
    text-align: start;
    text-decoration: none;

    background: transparent;

    &:hover,
    &[aria-current='page'] {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
  toggle: css`
    position: absolute;
    inset-block-start: 2px;
    inset-inline-end: 2px;
  `,
  title: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

/** Group navigation only: topic queries remain owned by the active group's sidebar. */
export default function GroupSwitcher({
  children,
  compact = false,
  sectionGroupId,
}: {
  children?: ReactNode;
  compact?: boolean;
  sectionGroupId?: string;
}) {
  const workspace = useActiveWorkspaceSlug();
  const { pathname } = useActiveLocation();
  const router = useQueryRoute();
  const prefetchGroup = usePrefetchGroup();
  const isLogin = useUserStore(authSelectors.isLogin);
  const activeGroupId = useAgentGroupStore((s) => s.activeGroupId);
  const sidebarGroupId = sectionGroupId ?? activeGroupId;
  const [open, setOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const enabled = !!isLogin && !workspace;
  const query = lambdaQuery.groupConversation.listGroups.useQuery(undefined, {
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  if (!enabled) return <>{children}</>;

  const groups = query.data ?? [];
  const own = groups.filter((group) => group.kind === 'owner');
  const joined = groups.filter((group) => group.kind === 'member');
  const renderGroup = (group: (typeof groups)[number]) => {
    const groupUrl = GROUP_CHAT_URL(group.groupId);
    const isCurrentGroup = pathname === groupUrl || pathname.startsWith(`${groupUrl}/`);
    const hasActiveSections = !compact && sidebarGroupId === group.groupId && !!children;
    const collapsed = collapsedGroups[group.groupId] ?? !hasActiveSections;
    const title =
      group.kind === 'owner' ? '我的超级工作群' : `${group.ownerDisplayName || '用户'}的群`;
    const label = (
      <>
        {group.avatar ? (
          <Avatar avatar={group.avatar} size={24} />
        ) : (
          <Icon icon={UsersRound} size={20} />
        )}
        <span className={styles.title}>{title}</span>
      </>
    );
    return (
      <div key={group.groupId} style={{ minWidth: 0, position: 'relative' }}>
        <button
          aria-current={isCurrentGroup ? 'page' : undefined}
          className={styles.link}
          title={title}
          type="button"
          onClick={() => {
            setCollapsedGroups((current) => ({
              ...current,
              [group.groupId]: false,
            }));
            if (pathname !== groupUrl) {
              router.push(groupUrl, { replace: true });
            }
            setOpen(false);
          }}
          onFocus={() => {
            if (!isCurrentGroup) void prefetchGroup(group.groupId, group.kind);
          }}
          onPointerDown={() => {
            if (!isCurrentGroup) void prefetchGroup(group.groupId, group.kind);
          }}
          onPointerEnter={() => {
            if (!isCurrentGroup) void prefetchGroup(group.groupId, group.kind);
          }}
        >
          {label}
        </button>
        <ActionIcon
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? '展开' : '收起'}${title}`}
          className={styles.toggle}
          icon={collapsed ? ChevronRight : ChevronDown}
          size={{ blockSize: 32, size: 16 }}
          onClick={() =>
            setCollapsedGroups((current) => ({
              ...current,
              [group.groupId]: !collapsed,
            }))
          }
        />
        {hasActiveSections ? (
          <div className={styles.children} hidden={collapsed}>
            {children}
          </div>
        ) : (
          !collapsed && (
            <div className={styles.children}>
              <GroupSidebarSections groupId={group.groupId} />
            </div>
          )
        )}
      </div>
    );
  };
  const content = (
    <Flexbox
      gap={4}
      padding={4}
      style={{
        minWidth: 0,
        maxHeight: compact ? '45dvh' : undefined,
        overflowY: compact ? 'auto' : undefined,
      }}
    >
      {query.isLoading && <SkeletonList rows={2} />}
      {query.isError ? (
        <Button onClick={() => void query.refetch()}>群列表加载失败，点击重试</Button>
      ) : (
        <>
          <Text fontSize={12} style={{ padding: '8px 8px 0' }} type="secondary">
            我自己的群
          </Text>
          {own.map(renderGroup)}
          <Text fontSize={12} style={{ padding: '8px 8px 0' }} type="secondary">
            我加入的群
          </Text>
          {joined.length
            ? joined.map(renderGroup)
            : !query.isLoading && (
                <Text fontSize={12} style={{ padding: 8 }} type="secondary">
                  暂无加入的群
                </Text>
              )}
        </>
      )}
      <PendingGroupInvitationNotice onNavigate={() => setOpen(false)} />
      {!compact &&
        (query.isError || !groups.some((group) => group.groupId === sidebarGroupId)) &&
        children}
    </Flexbox>
  );
  if (!compact) return content;
  return (
    <>
      <Popover
        nativeButton
        className={styles.popup}
        content={content}
        open={open}
        placement="rightTop"
        trigger="click"
        styles={{
          content: { minWidth: 200, maxWidth: '100%', padding: 4, boxSizing: 'border-box' },
        }}
        onOpenChange={setOpen}
      >
        <CompactListButton showChevron icon={UsersRound} title="切换群组" />
      </Popover>
      {children}
    </>
  );
}
