'use client';

import { ActionIcon, toast } from '@lobehub/ui/base-ui';
import { FileText, Share2 } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE, MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import GroupShareButton from '@/features/GroupMembership/GroupShareButton';
import { openShareModal } from '@/features/ShareModal';
import { LazySharePopover as SharePopover } from '@/features/SharePopover/lazy';
import { getVisibleShareTopicId } from '@/features/SuperGroup/visibleTopicShare';
import { usePermission } from '@/hooks/usePermission';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useGroupContext } from '../../useGroupContext';
import { useGroupConversationMessages } from '../../useGroupConversationMessages';

interface ShareButtonProps {
  mobile?: boolean;
}

const ShareButton = memo<ShareButtonProps>(({ mobile }) => {
  const { t } = useTranslation('chat');
  // A group conversation *is* a conversation with its supervisor agent, so the
  // topic-share policy is read off that agent — same resolution the group's
  // messages and topics are written with.
  const context = useGroupContext();
  const { agentId, groupId, topicId: activeTopicId } = context;
  const messages = useGroupConversationMessages(context);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<{
    groupId: typeof groupId;
    topicId: string;
    topicTitle: string;
    topicPreview?: string;
  }>();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const { allowed: canShare, reason } = usePermission('edit_own_content');
  const selected = target?.groupId === groupId ? target : undefined;
  useEffect(() => {
    setPopoverOpen(false);
    setTarget(undefined);
  }, [groupId]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) return setPopoverOpen(false);
    if (!canShare) return;
    const topicId = getVisibleShareTopicId(triggerRef.current);
    const topicMessages = messages?.filter((message) => message.topicId === topicId);
    if (!topicId || !topicMessages?.length) {
      setPopoverOpen(false);
      toast.info(t('shareModal.popover.visibleTopicMissing'));
      return;
    }
    const topic = topicSelectors.getTopicById(topicId)(useChatStore.getState());
    setTarget({
      groupId,
      topicId,
      topicTitle: topic?.title || t('superGroup.untitledTopic'),
      topicPreview: topicMessages
        .find((message) => message.role === 'user')
        ?.content?.slice(0, 120),
    });
    setPopoverOpen(true);
    // Timeline topics need not be in the sidebar's paginated cache. Resolve the
    // real title without changing the captured share target or blocking opening.
    if (!topic?.title) {
      void topicService
        .getTopicDetail(topicId)
        .then((detail) => {
          if (!detail?.title) return;
          setTarget((current) =>
            current?.groupId === groupId && current.topicId === topicId
              ? { ...current, topicTitle: detail.title }
              : current,
          );
        })
        .catch(() => {
          /* The captured opening message still identifies the topic. */
        });
    }
  };

  const handleExport = async () => {
    if (!selected || !canShare) return;
    try {
      await openShareModal({
        snapshot: {
          context: { ...context, topicId: selected.topicId },
          messages: messages?.filter((message) => message.topicId === selected.topicId) ?? [],
          title: selected.topicTitle,
        },
      });
    } catch {
      toast.error(t('shareModal.popover.loadError'));
    }
  };

  const groupShare = groupId ? <GroupShareButton groupId={groupId} /> : null;
  if (!activeTopicId) return groupShare;

  const iconButton = (
    <ActionIcon
      aria-label="分享聊天记录"
      disabled={!canShare}
      icon={groupId ? FileText : Share2}
      ref={triggerRef}
      size={mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SIZE}
      title={canShare ? t('shareModal.popover.visibleTopicAction') : reason}
      tooltipProps={{
        placement: 'bottom',
      }}
    />
  );

  if (!canShare)
    return (
      <>
        {groupShare}
        {iconButton}
      </>
    );

  return (
    <>
      {groupShare}
      <SharePopover
        agentId={agentId}
        open={popoverOpen && !!selected}
        topicId={selected?.topicId}
        topicPreview={selected?.topicPreview}
        topicTitle={selected?.topicTitle}
        onOpenChange={handleOpenChange}
        onOpenModal={handleExport}
      >
        {iconButton}
      </SharePopover>
    </>
  );
});

export default ShareButton;
