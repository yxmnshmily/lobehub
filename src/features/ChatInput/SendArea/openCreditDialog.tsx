import { createModal } from '@lobehub/ui/base-ui';
import { lazy, Suspense } from 'react';

import SkeletonText from '@/components/Skeleton/Text';
import { getTravelLocale, translateTravel } from '@/utils/i18n/travel';

const CreditsOrders = lazy(() => import('@/features/CustomerCenter/CreditsOrders'));
const SubscriptionWorkspace = lazy(() => import('@/features/CustomerCenter/SubscriptionWorkspace'));

export const openCreditDialog = (kind: 'credits' | 'plans') =>
  createModal({
    content: (
      <Suspense fallback={<SkeletonText rows={5} />}>
        {kind === 'credits' ? (
          <CreditsOrders locale={getTravelLocale()} />
        ) : (
          <SubscriptionWorkspace section="plans" />
        )}
      </Suspense>
    ),
    footer: null,
    maskClosable: true,
    styles: {
      content: { maxHeight: '76vh', overflowY: 'auto' },
      popup: { borderRadius: 16, overflow: 'hidden' },
    },
    title: translateTravel(kind === 'credits' ? '购买积分' : '升级套餐'),
    width: kind === 'credits' ? 'min(800px, 94vw)' : 'min(1200px, 94vw)',
  });
