'use client';

import { formatLocalizedTokens } from '@lobechat/utils/format';
import { Flexbox } from '@lobehub/ui';
import { Button, Popover } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ChevronDown, Gauge } from 'lucide-react';
import { useState } from 'react';

import { useSession } from '@/libs/better-auth/auth-client';
import { lambdaQuery } from '@/libs/trpc/client';
import { getTravelLocale, useTravelTranslation } from '@/utils/i18n/travel';

import { openCreditDialog } from './openCreditDialog';

export default function CreditBalance() {
  const t = useTravelTranslation();
  const [open, setOpen] = useState(false);
  const { data: session } = useSession();
  const query = lambdaQuery.customerCenter.getOverview.useQuery(
    { ledgerLimit: 1, recentLimit: 1 },
    {
      enabled: !!session?.user,
      refetchInterval: 15_000,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      retry: false,
    },
  );
  const balance = query.isError ? undefined : query.data?.credits?.account?.availableCredits;
  const valid = Number.isSafeInteger(balance) && (balance ?? -1) >= 0;
  const locale = getTravelLocale();
  const label = valid ? formatLocalizedTokens(balance!, locale) : '—';

  if (!session?.user) return null;

  return (
    <Popover
      nativeButton
      open={open}
      placement="topRight"
      trigger={['hover', 'click']}
      content={
        <Flexbox gap={16} style={{ width: 280, maxWidth: 'calc(100vw - 48px)' }}>
          <strong>{t('剩余额度')}</strong>
          <Flexbox horizontal align="baseline" gap={8}>
            <strong style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>
              {valid ? new Intl.NumberFormat(locale).format(balance!) : '—'}
            </strong>
            <span style={{ color: cssVar.colorTextSecondary }}>{t('可用积分余额')}</span>
          </Flexbox>
          {query.isError && (
            <Button onClick={() => void query.refetch()}>{t('加载失败，点击重试')}</Button>
          )}
          <Flexbox horizontal gap={8}>
            <Button
              style={{ flex: 1 }}
              onClick={() => {
                setOpen(false);
                openCreditDialog('credits');
              }}
            >
              {t('充值积分')}
            </Button>
            <Button
              style={{ flex: 1 }}
              type="primary"
              onClick={() => {
                setOpen(false);
                openCreditDialog('plans');
              }}
            >
              {t('升级')}
            </Button>
          </Flexbox>
        </Flexbox>
      }
      onOpenChange={setOpen}
    >
      <Button
        aria-label={`${t('积分额度')}：${label}`}
        size="small"
        type="text"
        style={{
          flexShrink: 0,
          gap: 4,
          border: 0,
          background: 'transparent',
          boxShadow: 'none',
          color: cssVar.colorWarning,
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        <Gauge aria-hidden size={14} />
        {label}
        <ChevronDown aria-hidden size={10} />
      </Button>
    </Popover>
  );
}
