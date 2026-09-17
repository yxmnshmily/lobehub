'use client';

import { ActionIcon, createModal, toast } from '@lobehub/ui/base-ui';
import { FileText, Share2 } from 'lucide-react';
import { use, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE, MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import GroupSharePanel from '@/features/GroupMembership/GroupSharePanel';
import { openShareModal } from '@/features/ShareModal';
import { SharePopoverContent } from '@/features/SharePopover';
import { ConversationFrameContext } from '@/features/SuperGroup/ConversationFrame';
import { getVisibleShareTopicId } from '@/features/SuperGroup/visibleTopicShare';
import { usePermission } from '@/hooks/usePermission';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useGroupContext } from '../../useGroupContext';
import { useGroupConversationMessages } from '../../useGroupConversationMessages';

function TopicShareContent({
  onExport,
  ...props
}: React.ComponentProps<typeof SharePopoverContent> & { onExport: (title?: string) => void }) {
  const [title, setTitle] = useState(props.topicTitle);
  useEffect(() => {
    let active = true;
    if (props.topicId)
      void topicService
        .getTopicDetail(props.topicId)
        .then((topic) => {
          if (active && topic?.title) setTitle(topic.title);
        })
        .catch(() => {
          /* The captured preview still identifies the selected topic. */
        });
    return () => {
      active = false;
    };
  }, [props.topicId]);
  return (
    <SharePopoverContent
      {...props}
      confirmOnCopy
      topicTitle={title}
      onOpenModal={() => onExport(title)}
    />
  );
}

export default function ShareButton({ mobile }: { mobile?: boolean }) {
  const { t } = useTranslation('chat');
  const context = useGroupContext();
  const frameRef = use(ConversationFrameContext);
  const { agentId, groupId } = context;
  const messages = useGroupConversationMessages(context);
  const { allowed: canShare, reason } = usePermission('edit_own_content');
  const [openingFiles, setOpeningFiles] = useState(false);
  const modalRef = useRef<ReturnType<typeof createModal> | null>(null);
  useEffect(
    () => () => {
      modalRef.current?.close();
    },
    [groupId],
  );
  const size = mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SIZE;
  if (!groupId) return null;

  return (
    <>
      <ActionIcon
        aria-label={t('groupInvitation.share')}
        icon={Share2}
        size={size}
        title={t('share', { ns: 'common' })}
        tooltipProps={{ placement: 'bottom' }}
        onClick={(event) => {
          const topicId = getVisibleShareTopicId(frameRef?.current ?? event.currentTarget);
          const topicMessages = messages?.filter((message) => message.topicId === topicId) ?? [];
          const topic = topicId
            ? topicSelectors.getTopicById(topicId)(useChatStore.getState())
            : undefined;
          const topicTitle = topic?.title || t('superGroup.untitledTopic');
          modalRef.current = createModal({
            title: t('share', { ns: 'common' }),
            footer: null,
            width: 'min(480px, calc(100vw - 32px))',
            content: (
              <GroupSharePanel
                groupId={groupId}
                topicContent={(close) =>
                  topicId && topicMessages.length ? (
                    <TopicShareContent
                      agentId={agentId}
                      topicId={topicId}
                      topicTitle={topicTitle}
                      topicPreview={topicMessages
                        .find((message) => message.role === 'user')
                        ?.content?.slice(0, 120)}
                      onClose={close}
                      onExport={async (resolvedTitle) => {
                        if (!canShare) return;
                        try {
                          await openShareModal({
                            snapshot: {
                              context: { ...context, topicId },
                              messages: topicMessages,
                              title: resolvedTitle || topicTitle,
                            },
                          });
                        } catch {
                          toast.error(t('shareModal.popover.loadError'));
                        }
                      }}
                    />
                  ) : null
                }
              />
            ),
          });
        }}
      />
      <ActionIcon
        aria-label="群文件"
        disabled={!canShare || openingFiles}
        icon={FileText}
        size={size}
        title={canShare ? '群文件' : reason}
        tooltipProps={{ placement: 'bottom' }}
        onClick={async () => {
          if (!canShare || openingFiles) return;
          setOpeningFiles(true);
          try {
            await openShareModal({ context, title: '群文件' });
          } catch {
            toast.error(t('shareModal.popover.loadError'));
          } finally {
            setOpeningFiles(false);
          }
        }}
      />
    </>
  );
}
