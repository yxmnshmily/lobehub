'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import SkeletonBar from '@/components/Skeleton/Bar';
import { withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';

export default function InvitationPage() {
  const { t } = useTranslation('chat');
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const signedIn = useUserStore((s) => s.isSignedIn);
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const valid = /^[\w-]{43}$/.test(token);
  const preview = lambdaQuery.groupMembership.previewInvitationLink.useQuery(
    { token },
    { enabled: valid, retry: false },
  );
  const join = lambdaQuery.groupMembership.joinInvitationLink.useMutation();
  const utils = lambdaQuery.useUtils();
  const callback = withLobeHubMountPath(`/group-invite?token=${encodeURIComponent(token)}`);

  return (
    <Flexbox align="center" justify="center" style={{ minHeight: '100dvh', padding: 24 }}>
      <Flexbox gap={20} style={{ width: '100%', maxWidth: 480 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>{t('groupInvitation.title')}</h1>
        {!valid || preview.isError ? (
          <Alert title={t('groupInvitation.invalid')} type="error" />
        ) : preview.isLoading ? (
          <SkeletonBar height={120} />
        ) : (
          <>
            <h2 style={{ margin: 0, fontSize: 18, overflowWrap: 'anywhere' }}>
              {preview.data?.title || t('groupInvitation.group')}
            </h2>
            <p style={{ margin: 0 }}>{t('groupInvitation.confirmHint')}</p>
            {signedIn ? (
              <Button
                disabled={join.isPending}
                loading={join.isPending}
                onClick={async () => {
                  setFailed(false);
                  try {
                    const result = await join.mutateAsync({ token });
                    await utils.groupConversation.listGroups.invalidate();
                    navigate(`/group/${encodeURIComponent(result.groupId)}`, { replace: true });
                  } catch {
                    setFailed(true);
                  }
                }}
              >
                {t('groupInvitation.join')}
              </Button>
            ) : (
              <Flexbox horizontal gap={12}>
                <Button
                  href={withLobeHubMountPath(`/signin?callbackUrl=${encodeURIComponent(callback)}`)}
                >
                  {t('groupInvitation.signin')}
                </Button>
                <Button
                  href={withLobeHubMountPath(`/signup?callbackUrl=${encodeURIComponent(callback)}`)}
                >
                  {t('groupInvitation.signup')}
                </Button>
              </Flexbox>
            )}
            {failed && <Alert title={t('groupInvitation.joinError')} type="error" />}
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
}
