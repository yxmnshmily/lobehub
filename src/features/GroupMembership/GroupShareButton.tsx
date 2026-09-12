'use client';

import { copyToClipboard, Flexbox, Input } from '@lobehub/ui';
import { ActionIcon, Alert, Button, createModal } from '@lobehub/ui/base-ui';
import { QRCode } from 'antd';
import { Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '@/components/Skeleton/Bar';
import { withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';
import { lambdaQuery } from '@/libs/trpc/client';

import WechatInvitationShare from './WechatInvitationShare';
import { isWechatBrowser } from './wechatShare';

export const GroupLinkPanel = ({ groupId }: { groupId: string }) => {
  const { t } = useTranslation('chat');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  const query = lambdaQuery.groupMembership.listParticipants.useQuery(
    { groupId, limit: 1 },
    { retry: false },
  );
  const { mutateAsync } = lambdaQuery.groupMembership.createInvitationLink.useMutation();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{ groupId: string; promise: ReturnType<typeof mutateAsync> } | null>(null);
  const owner = query.data?.viewerRole === 'owner' && !query.isError;

  useEffect(() => {
    if (!owner) return;
    let active = true;
    setUrl('');
    setFailed(false);
    if (request.current?.groupId !== groupId) {
      request.current = { groupId, promise: mutateAsync({ groupId }) };
    }
    // Reuse the in-flight request across StrictMode effect replays.
    void request.current.promise
      .then((result) => {
        if (!active) return;
        const path = withLobeHubMountPath(
          `/group-invite?token=${encodeURIComponent(result.token)}`,
        );
        setUrl(new URL(path, window.location.origin).href);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [groupId, owner, mutateAsync, attempt]);
  if (query.isLoading) return <SkeletonBar height={100} />;
  if (query.isError) return <Alert title={t('groupMembership.loadError')} type="error" />;
  if (query.data?.viewerRole !== 'owner') return <p>{t('groupInvitation.ownerOnly')}</p>;
  return (
    <Flexbox gap={16}>
      <p style={{ margin: 0 }}>{t('groupInvitation.hint')}</p>
      {url && (
        <>
          {isWechatBrowser() && <WechatInvitationShare groupId={groupId} link={url} />}
          <Input
            readOnly
            aria-label={t('groupInvitation.link')}
            value={url}
            onFocus={(event) => event.target.select()}
          />
          <QRCode size={180} style={{ alignSelf: 'center', background: '#fff' }} value={url} />
          <Button
            onClick={async () => {
              try {
                await copyToClipboard(url);
                setStatus(t('groupInvitation.copied'));
              } catch {
                setStatus(t('groupInvitation.copyError'));
              }
            }}
          >
            {t('groupInvitation.copy')}
          </Button>
        </>
      )}
      {!url && !failed && <SkeletonBar height={240} />}
      {failed && (
        <Alert
          title={t('groupInvitation.failed')}
          type="error"
          action={
            <Button
              onClick={() => {
                request.current = null;
                setAttempt((value) => value + 1);
              }}
            >
              {t('groupMembership.retry')}
            </Button>
          }
        />
      )}
      {status && (
        <p role="status" style={{ margin: 0 }}>
          {status}
        </p>
      )}
    </Flexbox>
  );
};

export default function GroupShareButton({ groupId }: { groupId: string }) {
  const { t } = useTranslation('chat');
  const title = t('groupInvitation.share');
  return (
    <ActionIcon
      aria-label={title}
      icon={Share2}
      title={title}
      tooltipProps={{ placement: 'bottom' }}
      onClick={() =>
        createModal({
          title,
          content: <GroupLinkPanel groupId={groupId} />,
          footer: null,
          width: 'min(480px, calc(100vw - 32px))',
        })
      }
    />
  );
}
