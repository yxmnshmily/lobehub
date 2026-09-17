import { usdToCredits } from '@lobechat/utils/credits';
import { Flexbox, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { formatCredits } from '@/features/CustomerCenter/model';
import { useMonthlyExchangeRate } from '@/features/CustomerCenter/useMonthlyExchangeRate';

export default function RunUsage({
  cost,
  duration,
}: {
  cost?: number | null;
  duration?: number | null;
}) {
  const { t, i18n } = useTranslation('common');
  const { format } = useMonthlyExchangeRate();
  const measured = typeof cost === 'number' && Number.isFinite(cost) && cost > 0;
  const formattedCost = measured ? format(cost, 2) : '—';
  const amount = /^[¥￥]/.test(formattedCost)
    ? `${formattedCost.replace(/^[¥￥]\s*/, '')}元`
    : formattedCost;
  const credits = measured ? formatCredits(usdToCredits(cost), i18n.language) : '—';
  const minutes =
    typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration / 60_000
      : 0;
  const time = !minutes
    ? '—'
    : minutes < 60
      ? `${Math.max(1, Math.round(minutes))}${t('runUsage.minutes')}`
      : minutes < 1440
        ? `${(minutes / 60).toFixed(1)}${t('runUsage.hours')}`
        : `${(minutes / 1440).toFixed(1)}${t('runUsage.days')}`;
  return (
    <Flexbox
      horizontal
      align="center"
      flex="none"
      gap={12}
      style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}
    >
      <Tooltip title={t('runUsage.durationHint')}>
        <span style={{ whiteSpace: 'nowrap' }} tabIndex={0}>
          {time}
        </span>
      </Tooltip>
      <Tooltip
        title={
          <Flexbox gap={4}>
            <span>
              {t('runUsage.referenceCost')}
              {/^zh(?:-|$)/i.test(i18n.language) ? '：' : ': '}
              {amount}
            </span>
            <span>{t('runUsage.creditsHint')}</span>
          </Flexbox>
        }
      >
        <Text
          color={cssVar.colorTextTertiary}
          fontSize={12}
          style={{ whiteSpace: 'nowrap' }}
          tabIndex={0}
        >
          {t('runUsage.equivalentCredits')} {credits}
        </Text>
      </Tooltip>
    </Flexbox>
  );
}
