'use client';

import { GROUP_CHAT_URL } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ArrowRight, FolderKanban, ListChecks, Target } from 'lucide-react';
import { useLocation } from 'react-router';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaQuery } from '@/libs/trpc/client';
import { useGlobalStore } from '@/store/global';
import { useProjectStore } from '@/store/project';
import { useTravelTranslation } from '@/utils/i18n/travel';

import CompactListButton from './CompactListButton';
import { useGroupWorkRequest } from './useGroupWorkRequest';

export default function GroupWorkLinks({
  groupId,
  compact = false,
}: {
  groupId: string;
  compact?: boolean;
}) {
  const t = useTravelTranslation();
  const router = useQueryRoute();
  const { pathname } = useLocation();
  const goals = lambdaQuery.goal.list.useQuery(
    { groupId, limit: 1 },
    { refetchOnWindowFocus: true, refetchInterval: 5000 },
  );
  const tasks = lambdaQuery.task.list.useQuery(
    { groupId, automated: false, limit: 1 },
    { refetchOnWindowFocus: true, refetchInterval: 5000 },
  );
  const projects = useProjectStore((s) => s.useFetchProjectList)(true);
  const counts = {
    goals: goals.data?.total,
    tasks: tasks.data?.total,
    projects: projects.data?.data.length,
  };
  const request = useGroupWorkRequest((s) => s.request);
  return (
    <Flexbox gap="var(--group-nav-gap, 8px)">
      {(
        [
          { kind: 'goals', title: t('目标'), icon: Target },
          { kind: 'tasks', title: t('任务'), icon: ListChecks },
          { kind: 'projects', title: '项目', icon: FolderKanban },
        ] as const
      ).map(({ kind, title, icon: Icon }) => {
        const active =
          kind === 'projects'
            ? pathname.startsWith(`${GROUP_CHAT_URL(groupId)}/project`)
            : pathname.startsWith(`${GROUP_CHAT_URL(groupId)}/${kind.slice(0, -1)}`) ||
              (request?.groupId === groupId && request.kind === kind);
        const onClick = () => {
          if (kind === 'projects') {
            useGroupWorkRequest.setState({ request: null });
            router.push(`${GROUP_CHAT_URL(groupId)}/projects`, { replace: true });
            useGlobalStore.getState().toggleMobileTopic(false);
            return;
          }
          useGroupWorkRequest.setState({ request: null });
          router.push(`${GROUP_CHAT_URL(groupId)}/${kind}`, { replace: true });
          useGlobalStore.getState().toggleMobileTopic(false);
        };
        return compact ? (
          <CompactListButton
            aria-current={active ? 'page' : undefined}
            icon={Icon}
            key={kind}
            title={title}
            onClick={onClick}
          />
        ) : (
          <div data-group-nav-branch="" key={kind}>
            <Button
              aria-current={active ? 'page' : undefined}
              aria-label={title}
              className="group-nav-section-header"
              type="text"
              style={{
                width: '100%',
                height: 'var(--group-nav-row-height, 44px)',
                paddingInline: 4,
                gap: 8,
                justifyContent: 'flex-start',
                color: cssVar.colorTextSecondary,
                background: active ? cssVar.colorFillTertiary : undefined,
              }}
              onClick={onClick}
            >
              <span
                className="group-nav-section-icon"
                style={{
                  width: 28,
                  display: 'inline-flex',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon aria-hidden size={18} />
              </span>
              <span data-nav-label="">
                {title}
                <span style={{ color: cssVar.colorError }}>（{counts[kind] ?? '…'}）</span>
              </span>
              <ArrowRight
                aria-hidden
                color={active ? cssVar.colorText : cssVar.colorTextQuaternary}
                data-nav-expanded-only=""
                size={16}
                style={{ marginInlineStart: 'auto', flexShrink: 0 }}
              />
            </Button>
          </div>
        );
      })}
    </Flexbox>
  );
}
