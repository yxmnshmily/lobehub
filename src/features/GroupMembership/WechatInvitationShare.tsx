'use client';

import { Alert } from '@lobehub/ui/base-ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';
import { lambdaQuery } from '@/libs/trpc/client';

import { clearWechatInvitation, configureWechatShare, wechatSigningUrl } from './wechatShare';

export default function WechatInvitationShare({
  groupId,
  link,
}: {
  groupId: string;
  link: string;
}) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const query = lambdaQuery.groupMembership.wechatShareConfig.useQuery(
    { groupId, url: wechatSigningUrl() },
    { retry: 1, retryDelay: 1000, staleTime: 60_000, refetchOnWindowFocus: false },
  );
  useEffect(() => {
    if (!query.data) return;
    const controller = new AbortController();
    setState('loading');
    void configureWechatShare(
      query.data,
      {
        title: query.data.title || t('groupInvitation.group'),
        desc: t('groupInvitation.wechatDescription'),
        link,
        imgUrl: new URL(withLobeHubMountPath('/app-icons/icon-192x192.png'), window.location.origin)
          .href,
      },
      controller.signal,
    )
      .then(() => {
        if (!controller.signal.aborted) setState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('failed');
      });
    return () => {
      controller.abort();
      clearWechatInvitation();
    };
  }, [query.data, link, t]);

  const failed = query.isError || state === 'failed';
  return (
    <Alert
      type={failed ? 'warning' : 'info'}
      title={t(
        failed
          ? 'groupInvitation.wechatFailed'
          : state === 'ready'
            ? 'groupInvitation.wechatReady'
            : 'groupInvitation.wechatLoading',
      )}
    />
  );
}
