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
        style={{ minHeight: 0, minWidth: 0, overflow: 'hidden', position: 'relative' }}
        width="100%"
      >
        {/* 抽屉式悬浮侧栏：展开时覆盖在聊天上方，不再把内容挤窄 */}
        {open && (
          <div
            style={{
              display: 'flex',
              insetBlock: 0,
              insetInlineStart: 0,
              position: 'absolute',
              zIndex: 50,
            }}
            onClick={() => setOpen(false)}
          >
            <CompactNavPanel expanded>{sidebar ?? <GroupSidebarContent />}</CompactNavPanel>
          </div>
        )}
        {children}
      </Flexbox>
    </MobileSidebarContext>
  );
}
