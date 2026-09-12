import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Popover } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MoreHorizontal, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import GroupShareButton from '@/features/GroupMembership/GroupShareButton';
import type { openShareModal } from '@/features/ShareModal';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';

import GroupInfoPanel from './GroupInfoPanel';
import GroupProfileButton from './GroupProfileButton';
import GroupSearchButton from './GroupSearchButton';

const popupClassName = createStaticStyles(
  ({ css }) => css`
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
  `,
);

const mobileShortcutClassName = createStaticStyles(
  ({ css }) => css`
    button {
      min-width: 44px;
      min-height: 44px;
    }
  `,
);

export default function GroupHeaderActions({
  groupId,
  profileHref,
  mobile,
  manageDefaultGroup = false,
  share,
  shareOptions,
  children,
  showMembers = true,
  canSearch = true,
}: {
  groupId?: string;
  profileHref?: string;
  mobile?: boolean;
  manageDefaultGroup?: boolean;
  share?: ReactNode;
  shareOptions?: Parameters<typeof openShareModal>[0];
  children?: ReactNode;
  showMembers?: boolean;
  canSearch?: boolean;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const profileAction = groupId && (
    <GroupProfileButton groupId={groupId} profileHref={profileHref} />
  );
  const searchAction =
    groupId &&
    (canSearch ? (
      <GroupSearchButton groupId={groupId} />
    ) : (
      <ActionIcon
        disabled
        aria-label="搜索群内容"
        icon={Search}
        title="当前身份无搜索权限"
        tooltipProps={{ placement: 'bottom' }}
      />
    ));
  const shareAction = share ?? (groupId && <GroupShareButton groupId={groupId} />);

  return (
    <Flexbox horizontal align="center" gap={mobile ? 4 : 8}>
      {children}
      {!mobile && profileAction}
      {!mobile && searchAction}
      {!mobile && <WideScreenButton />}
      {!mobile && shareAction}
      {groupId && (mobile || showMembers) && (
        <Popover
          nativeButton
          className={popupClassName}
          key={groupId}
          open={infoOpen}
          placement="bottomRight"
          trigger="click"
          content={
            <>
              {mobile && infoOpen && (
                <Flexbox
                  horizontal
                  align="center"
                  aria-label="群聊快捷操作"
                  className={mobileShortcutClassName}
                  gap={8}
                  justify="flex-end"
                  style={{
                    padding: 8,
                    borderBottom: showMembers ? `0.5px solid ${cssVar.colorBorderSecondary}` : 0,
                  }}
                >
                  {profileAction}
                  {searchAction}
                  {shareAction}
                </Flexbox>
              )}
              {infoOpen && (
                <>
                  {showMembers && (
                    <GroupInfoPanel
                      groupId={groupId}
                      key={groupId}
                      manageDefaultGroup={manageDefaultGroup}
                      shareOptions={shareOptions}
                      onClose={() => setInfoOpen(false)}
                    />
                  )}
                </>
              )}
            </>
          }
          styles={{
            root: { width: 'min(420px, calc(100vw - 24px))', maxWidth: 'var(--available-width)' },
            content: { boxSizing: 'border-box', width: '100%', padding: 0, overflow: 'hidden' },
          }}
          onOpenChange={setInfoOpen}
        >
          <ActionIcon
            aria-label="群聊更多操作"
            icon={MoreHorizontal}
            size={mobile ? MOBILE_HEADER_ICON_SIZE : undefined}
            title="更多"
          />
        </Popover>
      )}
    </Flexbox>
  );
}
