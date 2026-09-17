'use client';

import { copyToClipboard, Flexbox, Popover, usePopoverContext } from '@lobehub/ui';
import { Button, Checkbox, confirmModal, Select, Text, toast } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import {
  FileOutputIcon,
  ImageIcon,
  KeyRoundIcon,
  LinkIcon,
  LockIcon,
  PaperclipIcon,
  WrenchIcon,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ArticleSkeleton } from '@/components/Skeleton';
import { withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePermission } from '@/hooks/usePermission';
import { useTopicSharePermission } from '@/hooks/useTopicSharePermission';
import { shareKeys } from '@/libs/swr/keys';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { styles } from './style';

type Visibility = 'private' | 'link';

const PRIVACY_WARNING_ITEMS = [
  { icon: WrenchIcon, labelKey: 'shareModal.popover.privacyWarning.items.toolCalls' },
  { icon: KeyRoundIcon, labelKey: 'shareModal.popover.privacyWarning.items.credentials' },
  { icon: ImageIcon, labelKey: 'shareModal.popover.privacyWarning.items.images' },
  { icon: PaperclipIcon, labelKey: 'shareModal.popover.privacyWarning.items.files' },
] as const;

interface SharePopoverContentProps {
  /** Owner of the topic — carries the agent-level topic-share policy. */
  agentId?: string;
  confirmOnCopy?: boolean;
  onClose?: () => void;
  onOpenModal?: () => void;
  topicId?: string;
  topicPreview?: string;
  topicTitle?: string;
}

export const SharePopoverContent = memo<SharePopoverContentProps>((props) => {
  const {
    agentId,
    confirmOnCopy = false,
    onClose,
    onOpenModal,
    topicId,
    topicTitle,
    topicPreview,
  } = props;
  const [selectedVisibility, setSelectedVisibility] = useState<Visibility>(
    confirmOnCopy ? 'link' : 'private',
  );
  const { t } = useTranslation('chat');

  const [updating, setUpdating] = useState(false);
  const { close } = usePopoverContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const appOrigin = useAppOrigin();
  const { allowed: canShare, reason } = usePermission('edit_own_content');
  // Narrower than `canShare`: publishing a link may be reserved to the agent's
  // creator and workspace owners. Export and revoking stay open to everyone who
  // can reach this popover at all.
  const { allowed: canPublishLink, reason: publishRestrictedReason } =
    useTopicSharePermission(agentId);

  const chatActiveTopicId = useChatStore((s) => s.activeTopicId);
  const activeTopicId = topicId ?? chatActiveTopicId;
  const [hideTopicSharePrivacyWarning, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.systemStatus(s).hideTopicSharePrivacyWarning ?? false,
    s.updateSystemStatus,
  ]);

  // Scoped to the topic that failed: the popover is reused across topics, so a
  // sticky boolean would keep showing the error on the next one.
  const [failedTopicId, setFailedTopicId] = useState<string>();
  const {
    data: shareInfo,
    error: loadError,
    isLoading,
    mutate,
  } = useSWR(
    activeTopicId && canShare ? shareKeys.topicInfo(activeTopicId) : null,
    () => topicService.getShareInfo(activeTopicId!),
    { revalidateOnFocus: false },
  );

  // Auto-create share record if not exists. Surface failures (e.g. a 403 from
  // the share permission gate) instead of leaving the popover on the skeleton.
  // Skipped entirely when the caller cannot publish: the placeholder is of no
  // use to them, and under a restricted agent the server would refuse it.
  useEffect(() => {
    if (
      confirmOnCopy ||
      isLoading ||
      loadError ||
      shareInfo ||
      !activeTopicId ||
      !canShare ||
      !canPublishLink
    )
      return;
    // One attempt per topic — a rerender must not retry a create we know failed.
    if (failedTopicId === activeTopicId) return;

    topicService
      .enableSharing(activeTopicId, 'private')
      .then(() => mutate())
      .catch(() => setFailedTopicId(activeTopicId));
  }, [
    confirmOnCopy,
    isLoading,
    loadError,
    shareInfo,
    activeTopicId,
    canShare,
    canPublishLink,
    failedTopicId,
    mutate,
  ]);

  const shareUrl = shareInfo?.id
    ? `${appOrigin}${withLobeHubMountPath(`/share/t/${encodeURIComponent(shareInfo.id)}`)}`
    : '';
  const currentVisibility = confirmOnCopy
    ? canPublishLink
      ? selectedVisibility
      : (shareInfo?.visibility as Visibility) || 'private'
    : (shareInfo?.visibility as Visibility) || 'private';

  const updateVisibility = useCallback(
    async (visibility: Visibility) => {
      if (
        !activeTopicId ||
        !canShare ||
        (visibility === 'link' && !canPublishLink && shareInfo?.visibility !== 'link')
      )
        return;

      setUpdating(true);
      try {
        let info = shareInfo;
        if (info && info.visibility !== visibility) {
          await topicService.updateShareVisibility(activeTopicId, visibility);
        } else if (!info && visibility === 'link') {
          info = await topicService.enableSharing(activeTopicId, visibility);
        }
        await mutate();
        if (confirmOnCopy) setSelectedVisibility(visibility);
        const copyUrl = info?.id
          ? `${appOrigin}${withLobeHubMountPath(`/share/t/${encodeURIComponent(info.id)}`)}`
          : '';
        if (visibility === 'link' && !copyUrl) throw new Error('Missing share link');
        // Auto-copy the share link the moment link sharing is enabled
        if (visibility === 'link' && copyUrl) {
          await copyToClipboard(copyUrl);
          toast.success(t('shareModal.copyLinkSuccess'));
        } else {
          toast.success(t('shareModal.link.visibilityUpdated'));
        }
      } catch {
        toast.error(t('shareModal.link.updateError'));
      } finally {
        setUpdating(false);
      }
    },
    [activeTopicId, appOrigin, canShare, canPublishLink, confirmOnCopy, mutate, t, shareInfo],
  );

  const handleVisibilityChange = useCallback(
    (visibility: Visibility) => {
      // The `link` option is already disabled in that case; this is the guard
      // that keeps a keyboard selection from racing past it.
      if (visibility === 'link' && !canPublishLink && shareInfo?.visibility !== 'link') return;

      // Show confirmation when changing from private to link (unless user has dismissed it)
      if (
        (confirmOnCopy || currentVisibility === 'private') &&
        visibility === 'link' &&
        !hideTopicSharePrivacyWarning
      ) {
        let doNotShowAgain = false;

        confirmModal({
          cancelText: t('cancel', { ns: 'common' }),
          content: (
            <Flexbox gap={16}>
              {topicTitle && (
                <Text strong>{t('shareModal.popover.selectedTopic', { title: topicTitle })}</Text>
              )}
              <Text>{t('shareModal.popover.privacyWarning.content')}</Text>
              <Flexbox gap={12} paddingBlock={8}>
                {PRIVACY_WARNING_ITEMS.map(({ icon: ItemIcon, labelKey }) => (
                  <Flexbox horizontal align="center" gap={8} key={labelKey}>
                    <ItemIcon size={16} />
                    <Text>{t(labelKey)}</Text>
                  </Flexbox>
                ))}
              </Flexbox>
              <Text>{t('shareModal.popover.privacyWarning.note')}</Text>
              <Checkbox
                onChange={(v) => {
                  doNotShowAgain = v;
                }}
              >
                {t('shareModal.popover.privacyWarning.doNotShowAgain')}
              </Checkbox>
            </Flexbox>
          ),
          okText: t('shareModal.popover.privacyWarning.confirm'),
          onOk: () => {
            if (doNotShowAgain) {
              updateSystemStatus({ hideTopicSharePrivacyWarning: true });
            }
            return updateVisibility(visibility);
          },
          title: t('shareModal.popover.privacyWarning.title'),
        });
      } else {
        updateVisibility(visibility);
      }
    },
    [
      canPublishLink,
      confirmOnCopy,
      currentVisibility,
      hideTopicSharePrivacyWarning,
      shareInfo?.visibility,
      t,
      topicTitle,
      updateSystemStatus,
      updateVisibility,
    ],
  );

  const handleCopyLink = useCallback(async () => {
    if (confirmOnCopy) return handleVisibilityChange('link');
    if (!shareUrl) return;
    try {
      await copyToClipboard(shareUrl);
      toast.success(t('shareModal.copyLinkSuccess'));
    } catch {
      toast.error(t('shareModal.link.updateError'));
    }
  }, [confirmOnCopy, handleVisibilityChange, shareUrl, t]);

  const handleOpenModal = useCallback(() => {
    (onClose ?? close)();
    onOpenModal?.();
  }, [close, onClose, onOpenModal]);

  // Clearing the per-topic failure re-arms the create effect; `mutate` reruns
  // the read so a transient load error clears with it.
  const handleRetry = useCallback(() => {
    setFailedTopicId(undefined);
    void mutate();
  }, [mutate]);

  if (!canShare) {
    return (
      <Flexbox className={styles.container} gap={8}>
        <Text strong>{t('share', { ns: 'common' })}</Text>
        <Text type="secondary">{reason}</Text>
      </Flexbox>
    );
  }

  if (loadError || failedTopicId === activeTopicId) {
    return (
      <Flexbox className={styles.container} gap={8}>
        <Text strong>{t('share', { ns: 'common' })}</Text>
        <Text type="secondary">{t('shareModal.popover.loadError')}</Text>
        <Flexbox horizontal justify={'flex-end'}>
          <Button size="small" type="text" onClick={handleRetry}>
            {t('retry', { ns: 'common' })}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  }

  // Loading state. Without a share record a restricted caller still gets the
  // real body (visibility defaults to private) instead of an eternal skeleton.
  if (isLoading || (!confirmOnCopy && !shareInfo && canPublishLink)) {
    return (
      <Flexbox className={styles.container} gap={16}>
        <Text strong>{t('share', { ns: 'common' })}</Text>
        <ArticleSkeleton rows={2} />
      </Flexbox>
    );
  }

  const visibilityOptions = [
    {
      icon: <LockIcon size={14} />,
      label: t('shareModal.link.permissionPrivate'),
      value: 'private',
    },
    {
      disabled: !canPublishLink,
      icon: <LinkIcon size={14} />,
      label: t('shareModal.link.permissionLink'),
      value: 'link',
    },
  ];

  const getVisibilityHint = () => {
    // Why the link option is greyed out matters more than restating what
    // "private" means — a member who can't publish needs to know who to ask.
    if (!canPublishLink && currentVisibility === 'private') return publishRestrictedReason;

    switch (currentVisibility) {
      case 'private': {
        return t('shareModal.link.privateHint');
      }
      case 'link': {
        return t('shareModal.link.linkHint');
      }
    }
  };

  return (
    <Flexbox
      className={styles.container}
      data-sharing-topic-id={activeTopicId}
      gap={12}
      ref={containerRef}
    >
      <Text strong>{t('shareModal.popover.title')}</Text>

      {topicTitle && (
        <Flexbox gap={4} style={{ overflowWrap: 'anywhere' }}>
          <Text strong>{t('shareModal.popover.selectedTopic', { title: topicTitle })}</Text>
          {topicPreview && (
            <Text type="secondary">
              {t('shareModal.popover.topicOpening', { content: topicPreview })}
            </Text>
          )}
          <Text className={styles.hint} type="secondary">
            {t('shareModal.popover.visibleTopicHint')}
          </Text>
        </Flexbox>
      )}

      <Flexbox gap={4}>
        <Text type="secondary">{t('shareModal.popover.visibility')}</Text>
        <Select
          disabled={updating}
          options={visibilityOptions}
          style={{ width: '100%' }}
          value={currentVisibility}
          labelRender={({ value }) => {
            const option = visibilityOptions.find((o) => o.value === value);
            return (
              <Flexbox horizontal align="center" gap={8}>
                {option?.icon}
                {option?.label}
              </Flexbox>
            );
          }}
          optionRender={(option) => (
            <Flexbox horizontal align="center" gap={8}>
              {visibilityOptions.find((o) => o.value === option.value)?.icon}
              {option.label}
            </Flexbox>
          )}
          onChange={(visibility: Visibility) => {
            if (!confirmOnCopy) return handleVisibilityChange(visibility);
            if (visibility === 'link' && !canPublishLink) return;
            if (visibility === 'private') void updateVisibility(visibility);
            else setSelectedVisibility(visibility);
          }}
        />
      </Flexbox>

      <Text className={styles.hint} type="secondary">
        {getVisibilityHint()}
      </Text>

      <Divider style={{ margin: '4px 0' }} />

      <Flexbox horizontal align="center" justify="space-between">
        <Button icon={FileOutputIcon} size="small" type="text" onClick={handleOpenModal}>
          {t('shareModal.popover.export')}
        </Button>
        {currentVisibility !== 'private' && (
          <Button
            disabled={updating}
            icon={LinkIcon}
            loading={updating}
            size="small"
            type="primary"
            onClick={handleCopyLink}
          >
            {t('shareModal.copyLink')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
});

interface SharePopoverProps {
  /** Owner of the topic — carries the agent-level topic-share policy. */
  agentId?: string;
  children?: ReactNode;
  confirmOnCopy?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenModal?: () => void;
  open?: boolean;
  topicId?: string;
  topicPreview?: string;
  topicTitle?: string;
}

const SharePopover = memo<SharePopoverProps>(
  ({
    agentId,
    children,
    confirmOnCopy,
    onOpenModal,
    topicId,
    topicTitle,
    topicPreview,
    open,
    onOpenChange,
  }) => {
    const isMobile = useIsMobile();

    return (
      <Popover
        arrow={false}
        open={open}
        placement={isMobile ? 'top' : 'bottomRight'}
        trigger={['click']}
        content={
          <>
            {open !== false && (
              <SharePopoverContent
                agentId={agentId}
                confirmOnCopy={confirmOnCopy}
                key={topicId}
                topicId={topicId}
                topicPreview={topicPreview}
                topicTitle={topicTitle}
                onOpenModal={onOpenModal}
              />
            )}
          </>
        }
        styles={{
          content: {
            padding: 0,
            width: isMobile ? '100vw' : 366,
          },
        }}
        onOpenChange={onOpenChange}
      >
        {children}
      </Popover>
    );
  },
);

export default SharePopover;
