'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import { CloudIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type SaveStatus } from '@/types/saveState';

interface AutoSaveHintProps {
  lastUpdatedTime?: string | Date | null;
  /** Called when the user clicks Retry on a failed save. */
  onRetry?: () => void;
  saveStatus: SaveStatus;
  style?: CSSProperties;
}

/**
 * Neutral states render as bare icon + text (no Tag chrome at all — the base-ui
 * Tag keeps a filled background/border that survived style overrides in dark
 * mode). Only the failed state keeps the error Tag so the retry affordance
 * stays visually loud.
 */
const AutoSaveHint = memo<AutoSaveHintProps>(({ style, saveStatus, lastUpdatedTime, onRetry }) => {
  const { t } = useTranslation('editor');

  const renderBare = (icon: ReactNode, text: ReactNode) => (
    <Flexbox
      horizontal
      align={'center'}
      gap={4}
      style={{ background: 'transparent', color: 'var(--ant-color-text-secondary)', ...style }}
    >
      {icon}
      {text}
    </Flexbox>
  );

  if (saveStatus === 'saving')
    return renderBare(<Icon spin icon={Loader2Icon} />, t('autoSave.saving'));

  if (saveStatus === 'failed')
    return (
      <Tag
        color={'error'}
        icon={<Icon icon={TriangleAlertIcon} />}
        style={{ cursor: onRetry ? 'pointer' : undefined, ...style }}
        onClick={onRetry}
      >
        {t('autoSave.failed')}
        {onRetry ? ` · ${t('autoSave.retry')}` : ''}
      </Tag>
    );

  if (saveStatus === 'saved' && lastUpdatedTime)
    return renderBare(
      <Icon icon={CloudIcon} />,
      <>
        {t('autoSave.saved')} {dayjs(lastUpdatedTime).fromNow()}
      </>,
    );

  return renderBare(<Icon icon={CloudIcon} />, t('autoSave.latest'));
});

export default AutoSaveHint;
