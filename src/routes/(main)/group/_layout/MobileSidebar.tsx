'use client';

import { Flexbox } from '@lobehub/ui';
import { type ReactNode, useState } from 'react';

import { CompactNavPanel } from '@/features/NavPanel/components/NavPanelDraggable';
import { MobileSidebarContext } from '@/features/SuperGroup/useMobileGroupSidebar';

import GroupSidebarContent from './Sidebar/Content';

/* 手机端群聊：去掉消息块顶部的 8px 起始边距（用户要求：头部边距去掉）；
   消息之间仍保留 8px 底部间距。注入 <style> 保证生效。 */
const MOBILE_GROUP_CHAT_CSS = `
[data-conversation-viewport] .message-wrapper { padding-block-start: 0; }
`;

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
      <style dangerouslySetInnerHTML={{ __html: MOBILE_GROUP_CHAT_CSS }} />
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
