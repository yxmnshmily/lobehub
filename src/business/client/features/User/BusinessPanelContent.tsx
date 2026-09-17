import { formatLocalizedTokens } from '@lobechat/utils/format';
import { Flexbox } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { lambdaQuery } from '@/libs/trpc/client';
import { getTravelLocale } from '@/utils/i18n/travel';

export default function BusinessPanelContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('common');
  const query = lambdaQuery.platformCredit.getOwnRegistrationCredits.useQuery(undefined, {
    refetchInterval: 15_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: false,
  });
  const accountQuery = lambdaQuery.platformCredit.getOwnAccount.useQuery(undefined, {
    refetchInterval: 15_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: false,
  });
  const account = accountQuery.isError ? undefined : accountQuery.data;
  const credits = query.isError ? undefined : query.data;
  const balancePercent =
    account && credits?.totalCredits
      ? Math.max(0, Math.min(100, (account.balanceCredits / credits.totalCredits) * 100))
      : 0;
  const percent =
    credits && credits.totalCredits > 0
      ? Math.max(0, Math.min(100, (credits.remainingCredits / credits.totalCredits) * 100))
      : 0;
  const number = (value: number) => formatLocalizedTokens(value, getTravelLocale());
  return (
    <WorkspaceLink
      escape
      style={{ color: 'inherit', padding: '16px' }}
      title={t('userPanel.registrationGift', { defaultValue: '新注册首次赠送500万积分，无需充值' })}
      to="/settings/credits"
      onClick={onNavigate}
    >
      <Flexbox gap={8} style={{ minWidth: 0, width: '100%' }}>
        <Flexbox
          horizontal
          align="center"
          gap={16}
          justify="space-between"
          style={{ flexWrap: 'wrap', minWidth: 0, rowGap: 8 }}
        >
          <span style={{ color: cssVar.colorTextSecondary, whiteSpace: 'nowrap' }}>
            {t('userPanel.freeCredits', { defaultValue: '免费积分' })}
          </span>
          <Flexbox
            horizontal
            align="center"
            gap={10}
            style={{ marginInlineStart: 'auto', maxWidth: '100%', minWidth: 0 }}
          >
            <span
              style={{ fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
            >
              {credits
                ? `${number(credits.remainingCredits)} / ${number(credits.totalCredits)}`
                : '— / —'}
            </span>
            <span
              aria-label={t('userPanel.freeCredits', { defaultValue: '免费积分' })}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={credits ? Math.round(percent) : undefined}
              role="progressbar"
              style={{ display: 'inline-flex', flexShrink: 0 }}
            >
              <Progress
                aria-hidden
                percent={percent}
                railColor={cssVar.colorFillSecondary}
                showInfo={false}
                size={22}
                strokeColor={cssVar.colorWarning}
                strokeWidth={14}
                type="circle"
              />
            </span>
          </Flexbox>
        </Flexbox>
        <Flexbox
          horizontal
          align="center"
          gap={16}
          justify="space-between"
          style={{ flexWrap: 'wrap', minWidth: 0, rowGap: 8 }}
        >
          <span style={{ color: cssVar.colorTextSecondary, whiteSpace: 'nowrap' }}>
            {t('userPanel.remainingCredits', { defaultValue: '剩余积分' })}
          </span>
          <Flexbox
            horizontal
            align="center"
            gap={10}
            style={{ marginInlineStart: 'auto', maxWidth: '100%', minWidth: 0 }}
          >
            <span
              style={{ fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
            >
              {account ? number(account.balanceCredits) : '—'}
            </span>
            <span
              aria-label={t('userPanel.remainingCredits', { defaultValue: '剩余积分' })}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={account ? Math.round(balancePercent) : undefined}
              role="progressbar"
              style={{ display: 'inline-flex', flexShrink: 0 }}
            >
              <Progress
                aria-hidden
                percent={balancePercent}
                railColor={cssVar.colorFillSecondary}
                showInfo={false}
                size={22}
                strokeColor={cssVar.colorWarning}
                strokeWidth={14}
                type="circle"
              />
            </span>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </WorkspaceLink>
  );
}
