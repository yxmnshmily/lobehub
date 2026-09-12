'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { lambdaQuery } from '@/libs/trpc/client';

export default function PendingGroupInvitationNotice({
  enabled = true,
  onNavigate,
}: {
  enabled?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation('chat');
  const invitations = lambdaQuery.groupMembership.listMyPendingInvitations.useQuery(undefined, {
    enabled,
    gcTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const pendingCount = invitations.data?.items.length ?? 0;

  if (!enabled || pendingCount === 0 || invitations.isError) return null;
  return (
    <WorkspaceLink
      to="/settings/profile"
      style={{
        background: cssVar.colorInfoBg,
        border: `0.5px solid ${cssVar.colorInfoBorder}`,
        borderRadius: cssVar.borderRadiusLG,
        color: cssVar.colorInfoText,
        display: 'block',
        flexShrink: 0,
        padding: 12,
        minWidth: 0,
        overflowWrap: 'anywhere',
        textDecoration: 'none',
      }}
      onClick={onNavigate}
    >
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" gap={8}>
          <Mail aria-hidden size={20} style={{ flexShrink: 0 }} />
          <span aria-live="polite" style={{ fontWeight: 600 }}>
            {t('superGroup.pendingInvitations', {
              amount: `${pendingCount}${invitations.data?.nextOffset != null ? '+' : ''}`,
            })}
          </span>
        </Flexbox>
        <span>{t('superGroup.invitationHint')}</span>
        <span style={{ fontWeight: 600, textDecoration: 'underline' }}>
          {t('superGroup.viewInvitations')}
        </span>
      </Flexbox>
    </WorkspaceLink>
  );
}
