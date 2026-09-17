import { usdToCredits } from '@lobechat/utils/credits';
import { useTranslation } from 'react-i18next';

import { formatCredits } from '@/features/CustomerCenter/model';
import type { ChatTopic } from '@/types/topic';

export function TopicAssociations({ topic }: { topic: ChatTopic }) {
  const { t } = useTranslation('topic');
  const label = topic.businessAssociations?.length
    ? topic.businessAssociations
        .map((item) => `${t(`management.association.${item.kind}`)}：${item.title}`)
        .join('；')
    : t('management.association.none');
  return (
    <span
      title={label}
      style={{
        display: 'block',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

export function TopicCredits({ topic }: { topic: ChatTopic }) {
  const { t, i18n } = useTranslation('topic');
  const value = topic.cost == null ? NaN : Number(topic.cost);
  const credits =
    Number.isFinite(value) && value >= 0 ? formatCredits(usdToCredits(value), i18n.language) : '—';
  return (
    <span style={{ whiteSpace: 'nowrap' }} title={t('management.creditsHint')}>
      {credits}
    </span>
  );
}
