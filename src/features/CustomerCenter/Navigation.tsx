'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Drawer } from '@lobehub/ui/base-ui';
import {
  BrainCircuit,
  ChartColumnBigIcon,
  Coins,
  CreditCard,
  FolderKanban,
  Menu,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { translateTravel, useTravelTranslation } from '@/utils/i18n/travel';
import { isModifierClick } from '@/utils/navigation';

export const isCustomerCenterPath = (pathname: string) =>
  /^\/settings\/(?:profile|security|plans|usage|credits|billing)\/?$/.test(pathname) ||
  /^\/memory(?:\/|$)/.test(pathname);

const items = [
  {
    key: 'account-security',
    get label() {
      return translateTravel('账号与安全');
    },
    icon: ShieldCheck,
    href: '/settings/profile',
  },
  {
    key: 'memory',
    get label() {
      return translateTravel('我的记忆');
    },
    icon: BrainCircuit,
    href: '/memory',
  },
  {
    key: 'plans',
    get label() {
      return translateTravel('费用套餐');
    },
    icon: CreditCard,
    href: '/settings/plans',
  },
  {
    key: 'balance-usage',
    get label() {
      return translateTravel('账户用量');
    },
    icon: ChartColumnBigIcon,
    href: '/settings/usage',
  },
  {
    key: 'credits',
    get label() {
      return translateTravel('积分余额');
    },
    icon: Coins,
    href: '/settings/credits',
  },
  {
    key: 'my-creations',
    get label() {
      return translateTravel('我的生成');
    },
    icon: FolderKanban,
    href: '/settings/profile?section=my-creations',
  },
];

const CustomerCenterNavigation = ({ onNavigate }: { onNavigate?: () => void }) => {
  const translateTravel = useTravelTranslation();
  const location = useActiveLocation();
  const navigate = useWorkspaceAwareNavigate();
  const requestedSection = new URLSearchParams(location.search).get('section');
  const section =
    location.pathname === '/settings/billing' || requestedSection === 'recharge-history'
      ? 'credits'
      : requestedSection;
  const activeKey = /^\/memory(?:\/|$)/.test(location.pathname)
    ? 'memory'
    : section && items.some((item) => item.key === section)
      ? section
      : (items.find((item) => item.href === location.pathname)?.key ?? 'account-security');

  return (
    <Flexbox aria-label={translateTravel('个人中心菜单')} as={'nav'} gap={4} padding={8}>
      {items.map((item) => (
        <Link
          aria-current={activeKey === item.key ? 'page' : undefined}
          key={item.key}
          to={item.href}
          onClick={(event) => {
            if (isModifierClick(event)) return;
            event.preventDefault();
            navigate(item.href, { escape: true });
            onNavigate?.();
          }}
        >
          <NavItem active={activeKey === item.key} icon={item.icon} title={item.label} />
        </Link>
      ))}
    </Flexbox>
  );
};

export default CustomerCenterNavigation;

export const CustomerCenterMobileMenu = () => {
  const translateTravel = useTravelTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionIcon
        aria-label={translateTravel('展开个人中心菜单')}
        icon={Menu}
        onClick={() => setOpen(true)}
      />
      <Drawer
        open={open}
        placement={'left'}
        title={translateTravel('个人中心')}
        width={280}
        onClose={() => setOpen(false)}
      >
        <CustomerCenterNavigation onNavigate={() => setOpen(false)} />
      </Drawer>
    </>
  );
};
