'use client';

import InboxButton from '@/features/HomeSidebar/Header/components/InboxButton';
import User from '@/features/HomeSidebar/Header/components/User';

import SideBarHeaderLayout from './SideBarHeaderLayout';

/** One account menu and notification entry owned by the navigation shell. */
export default function AccountHeader({ compact = false }: { compact?: boolean }) {
  return (
    <SideBarHeaderLayout
      left={<User lite={compact} />}
      right={<InboxButton />}
      showBack={false}
      showTogglePanelButton={false}
    />
  );
}
