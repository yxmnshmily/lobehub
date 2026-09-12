'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Gauge } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import { useActiveBenchmarkId } from '../useActiveBenchmarkId';
import BenchmarkHead from './BenchmarkHead';

const Header = memo(() => {
  const benchmarkId = useActiveBenchmarkId();
  const { t } = useTranslation('common');
  return (
    <SideBarHeaderLayout
      backTo="/eval"
      left={<BenchmarkHead id={benchmarkId} />}
      breadcrumb={[
        {
          href: `/eval/bench/${benchmarkId}`,
          title: (
            <Flexbox
              horizontal
              align="center"
              gap={6}
              style={{ color: 'inherit', fontSize: 14, whiteSpace: 'nowrap' }}
            >
              <Icon icon={Gauge} />
              <span>{t('tab.eval')}</span>
            </Flexbox>
          ),
        },
      ]}
    />
  );
});

export default Header;
