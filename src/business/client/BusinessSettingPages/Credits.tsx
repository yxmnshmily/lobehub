import { useSearchParams } from 'react-router';

import SubscriptionWorkspace from '@/features/CustomerCenter/SubscriptionWorkspace';

import CustomerCenterPage from './CustomerCenterPage';

const Credits = () => {
  const [params] = useSearchParams();
  // Preserve bookmarks for the existing personal-center sections.
  const section = params.get('section');
  if (section === 'my-creations' || section === 'account-security') return <CustomerCenterPage />;
  return (
    <SubscriptionWorkspace
      section={
        section === 'balance-usage'
          ? 'usage'
          : section === 'recharge-history'
            ? 'billing'
            : section === 'plans'
              ? 'plans'
              : 'credits'
      }
    />
  );
};

export default Credits;
