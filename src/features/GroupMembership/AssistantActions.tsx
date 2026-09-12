import { Flexbox } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentGroupStore } from '@/store/agentGroup';

import AssistantMenu from './AssistantMenu';

export default function AssistantActions({
  agentId,
  groupId,
  isSupervisor,
  onUpdated,
  title,
  compact = false,
  onNavigate,
  pinned,
  sessionGroupId,
}: {
  agentId: string;
  groupId: string;
  isSupervisor?: boolean;
  onUpdated: () => Promise<unknown>;
  title: string;
  compact?: boolean;
  onNavigate?: () => void;
  pinned?: boolean | null;
  sessionGroupId?: string | null;
}) {
  const { t } = useTranslation(['common', 'chat']);
  const access = lambdaQuery.platformAccess.isPlatformAdmin.useQuery(undefined, { retry: false });
  const key = useAgentGroupStore(
    (s) => s.groupMap[groupId]?.config?.memberSlots?.find((slot) => slot.agentId === agentId)?.key,
  );
  const remove = lambdaQuery.platformOperations.removeSuperGroupTemplateMember.useMutation();

  const canConfigure = access.data === true && !access.isLoading && !access.isError;

  return (
    <Flexbox horizontal align="center" gap={8} style={{ flex: 'none' }}>
      {!compact && canConfigure && (
        <Link
          aria-label={`${t('edit')} ${title}`}
          to={`/agent/${encodeURIComponent(agentId)}/profile`}
          style={{
            alignItems: 'center',
            border: `0.5px solid ${cssVar.colorBorder}`,
            borderRadius: cssVar.borderRadius,
            boxSizing: 'border-box',
            display: 'flex',
            justifyContent: 'center',
            minHeight: 44,
            paddingInline: 15,
            whiteSpace: 'nowrap',
          }}
          onClick={onNavigate}
        >
          {t('edit')}
        </Link>
      )}
      <AssistantMenu
        agentId={agentId}
        canConfigure={canConfigure}
        canRename={!isSupervisor}
        compact={compact}
        pinned={pinned}
        sessionGroupId={sessionGroupId}
        title={title}
        onNavigate={onNavigate}
        onRemove={
          !isSupervisor && key && !remove.isPending
            ? () =>
                confirmModal({
                  title: t('delete'),
                  content: t('groupMembership.templateRemoveDescription', {
                    ns: 'chat',
                    name: title,
                  }),
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    if (!key) return;
                    try {
                      await remove.mutateAsync({ key });
                      await Promise.all([
                        onUpdated(),
                        useAgentGroupStore.getState().refreshGroupDetail(groupId),
                      ]);
                    } catch {
                      toast.error(t('groupMembership.actionError', { ns: 'chat' }));
                    }
                  },
                })
            : undefined
        }
        onUpdated={async () => {
          await Promise.all([
            onUpdated(),
            useAgentGroupStore.getState().refreshGroupDetail(groupId),
          ]);
        }}
      />
    </Flexbox>
  );
}
