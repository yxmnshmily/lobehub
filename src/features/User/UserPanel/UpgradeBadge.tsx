import { Flexbox } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import { useTravelTranslation } from '@/utils/i18n/travel';

const UpgradeBadge = memo(({ children, showBadge }: PropsWithChildren<{ showBadge?: boolean }>) => {
  const translateTravel = useTravelTranslation();
  if (!showBadge) return children;

  return (
    <Flexbox horizontal align={'center'} gap={2}>
      {children}
      <Tag color={'info'} size={'small'} style={{ borderRadius: 16, paddingInline: 8 }}>
        {translateTravel('新')}
      </Tag>
    </Flexbox>
  );
});

export default UpgradeBadge;
