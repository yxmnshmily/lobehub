'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react';
import { memo } from 'react';

import type { MyTravelGroupReadiness } from '@/services/home';

const styles = createStaticStyles(({ css }) => ({
  row: css`
    min-height: 36px;
    padding-inline: 8px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface TravelGroupReadinessProps {
  isRetrying?: boolean;
  onRetry: () => void;
  status?: MyTravelGroupReadiness['status'];
}

const TravelGroupReadiness = memo<TravelGroupReadinessProps>(
  ({ isRetrying, onRetry, status }) => {
    if (!status || status === 'ready') return null;

    if (status === 'preparing') {
      return (
        <Flexbox horizontal align="center" className={styles.row} gap={8} role="status">
          <Icon spin icon={LoaderCircleIcon} size={14} />
          <Text color={cssVar.colorTextSecondary} fontSize={13}>
            正在准备您的专属旅游群
          </Text>
        </Flexbox>
      );
    }

    if (status === 'review_required') {
      return (
        <Flexbox horizontal align="center" className={styles.row} gap={8} role="status">
          <Icon icon={TriangleAlertIcon} size={14} />
          <Text color={cssVar.colorTextSecondary} fontSize={13}>
            专属旅游群需要管理员检查
          </Text>
        </Flexbox>
      );
    }

    return (
      <Flexbox horizontal align="center" className={styles.row} gap={8} role="alert">
        <Text color={cssVar.colorTextSecondary} fontSize={13}>
          专属旅游群准备失败
        </Text>
        <Button loading={isRetrying} size="small" type="text" onClick={onRetry}>
          重试
        </Button>
      </Flexbox>
    );
  },
);

TravelGroupReadiness.displayName = 'TravelGroupReadiness';

export default TravelGroupReadiness;
