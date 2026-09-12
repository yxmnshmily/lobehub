import { Flexbox, Icon } from '@lobehub/ui';
import { UserRound } from 'lucide-react';

import CustomerCenterNavigation, {
  isCustomerCenterPath,
} from '@/features/CustomerCenter/Navigation';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import Body from './Body';
import Header from './Header';

const SidebarContent = () => {
  const location = useActiveLocation();
  if (isCustomerCenterPath(location.pathname)) {
    return (
      <SideBarLayout
        body={<CustomerCenterNavigation />}
        header={
          <SideBarHeaderLayout
            breadcrumb={[
              {
                href: '/settings/profile',
                title: (
                  <Flexbox
                    horizontal
                    align="center"
                    gap={6}
                    style={{ color: 'inherit', fontSize: 14, whiteSpace: 'nowrap' }}
                  >
                    <Icon icon={UserRound} />
                    <span>个人中心</span>
                  </Flexbox>
                ),
              },
            ]}
          />
        }
      />
    );
  }
  return <SideBarLayout body={<Body />} header={<Header />} />;
};

export default SidebarContent;
