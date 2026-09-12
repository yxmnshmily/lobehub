'use client';

import type { UIChatMessage } from '@lobechat/types';
import { ActionIcon, toast } from '@lobehub/ui/base-ui';
import { FileText } from 'lucide-react';
import { useState } from 'react';

import { DESKTOP_HEADER_ICON_SIZE, MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import GroupShareButton from '@/features/GroupMembership/GroupShareButton';
import { openShareModal } from '@/features/ShareModal';
import { usePermission } from '@/hooks/usePermission';

export default function JoinedConversationShareButton({
  groupId,
  topicId,
  messages,
  title,
  mobile,
}: {
  groupId: string;
  topicId?: string | null;
  messages: UIChatMessage[];
  title: string;
  mobile?: boolean;
}) {
  const [opening, setOpening] = useState(false);
  const { allowed, reason } = usePermission('edit_own_content');
  return (
    <>
      <GroupShareButton groupId={groupId} />
      <ActionIcon
        aria-label="分享聊天内容"
        disabled={!allowed || messages.length === 0 || opening}
        icon={FileText}
        size={mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SIZE}
        title={!allowed ? reason : messages.length ? '分享聊天内容' : '暂无可分享的聊天内容'}
        tooltipProps={{ placement: 'bottom' }}
        onClick={async () => {
          if (opening || !allowed) return;
          setOpening(true);
          try {
            await openShareModal({
              snapshot: {
                context: {
                  agentId: '',
                  groupId,
                  topicId: topicId ?? null,
                  scope: 'group',
                  threadId: null,
                },
                messages,
                title,
              },
            });
          } catch {
            toast.error('分享面板加载失败，请重试');
          } finally {
            setOpening(false);
          }
        }}
      />
    </>
  );
}
