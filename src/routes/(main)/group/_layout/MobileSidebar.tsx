'use client';

import { Flexbox } from '@lobehub/ui';
import { type ReactNode, useState } from 'react';

import { CompactNavPanel } from '@/features/NavPanel/components/NavPanelDraggable';
import { MobileSidebarContext } from '@/features/SuperGroup/useMobileGroupSidebar';

import GroupSidebarContent from './Sidebar/Content';

export default function MobileSidebar({
  children,
  sidebar,
  disabled = false,
}: {
  children: ReactNode;
  sidebar?: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (disabled) return children;
  return (
    <MobileSidebarContext value={{ open, toggle: () => setOpen((value) => !value) }}>
      <Flexbox
        horizontal
        flex={1}
        height="100%"
        style={{ minHeight: 0, minWidth: 0, overflow: 'hidden' }}
        width="100%"
      >
        {open && <CompactNavPanel>{sidebar ?? <GroupSidebarContent />}</CompactNavPanel>}
        {children}
      </Flexbox>
    </MobileSidebarContext>
  );
}
