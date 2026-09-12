'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Archive, Star, Trash2, X } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { confirmRemoveTopic } from '@/features/DeleteTopicConfirm';
import { useChatStore } from '@/store/chat';

import MoveToAgentButton from './MoveToAgentButton';
import { useTopicsViewStore } from './store';
import type { TopicManagementActions } from './types';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    pointer-events: auto;

    padding-block: 8px;
    padding-inline: 16px;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  divider: css`
    width: 0.5px;
    height: 16px;
    margin-inline: 2px;
    background: ${cssVar.colorBorderSecondary};
  `,
  overlay: css`
    pointer-events: none;

    position: fixed;
    z-index: 1000;
    inset-block-end: 24px;
    inset-inline: 0;

    display: flex;
    justify-content: center;
  `,
}));

const BulkActionBar = memo(({ management }: { management?: TopicManagementActions }) => {
  const { t } = useTranslation('topic');
  const [busy, setBusy] = useState(false);

  const selectedIds = useTopicsViewStore((s) => s.selectedIds);
  const exitSelectMode = useTopicsViewStore((s) => s.exitSelectMode);

  const favoriteTopic = useChatStore((s) => management?.favoriteTopic ?? s.favoriteTopic);
  const updateTopicStatus = useChatStore(
    (s) => management?.updateTopicStatus ?? s.updateTopicStatus,
  );
  const removeTopic = useChatStore((s) => management?.removeTopic ?? s.removeTopic);
  const status = useTopicsViewStore((s) => s.status);
  const restore = !!management && status === 'completed';
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch {
      toast.error(t('operationFailed', { ns: 'common', defaultValue: '操作失败，请重试' }));
    } finally {
      setBusy(false);
    }
  };

  const handleBatchFavorite = useCallback(async () => {
    await Promise.all(selectedIds.map((id) => favoriteTopic(id, true)));
    exitSelectMode();
  }, [selectedIds, favoriteTopic, exitSelectMode]);

  const handleBatchArchive = useCallback(async () => {
    // "Archive" in the UI is a friendlier name for marking topics as
    // completed — the dedicated `archived` status isn't surfaced to users.
    await Promise.all(
      selectedIds.map((id) =>
        updateTopicStatus({ status: restore ? 'active' : 'completed', topicId: id }),
      ),
    );
    exitSelectMode();
  }, [selectedIds, updateTopicStatus, exitSelectMode, restore]);

  const handleBatchDelete = useCallback(() => {
    void confirmRemoveTopic({
      content: t('management.bulk.deleteConfirm', { count: selectedIds.length }),
      okText: t('management.bulk.delete'),
      onConfirm: async (removeFiles) => {
        setBusy(true);
        try {
          // Serial removal so each call's optimistic update + refetch resolves
          // cleanly; parallel removeTopic causes cascading refetches.
          for (const id of selectedIds) {
            await removeTopic(id, removeFiles);
          }
          exitSelectMode();
        } finally {
          setBusy(false);
        }
      },
      title: t('management.bulk.deleteTitle'),
      topicIds: selectedIds,
    });
  }, [selectedIds, t, removeTopic, exitSelectMode]);

  if (selectedIds.length === 0) return null;

  return (
    <div className={styles.overlay}>
      <Flexbox horizontal align={'center'} className={styles.bar} gap={4}>
        <Text style={{ marginInlineEnd: 8 }} weight={500}>
          {t('management.bulk.selectedCount', { count: selectedIds.length })}
        </Text>
        <ActionIcon
          aria-label={t('management.bulk.favorite')}
          disabled={busy}
          icon={Star}
          size={'small'}
          title={t('management.bulk.favorite')}
          onClick={() => {
            void run(handleBatchFavorite);
          }}
        />
        <ActionIcon
          aria-label={
            restore
              ? t('actions.unarchive', { defaultValue: '恢复为活跃话题' })
              : t('management.bulk.archive')
          }
          disabled={busy}
          icon={Archive}
          size={'small'}
          title={
            restore
              ? t('actions.unarchive', { defaultValue: '恢复为活跃话题' })
              : t('management.bulk.archive')
          }
          onClick={() => {
            void run(handleBatchArchive);
          }}
        />
        <MoveToAgentButton />
        <ActionIcon
          aria-label={t('management.bulk.delete')}
          disabled={busy}
          icon={Trash2}
          size={'small'}
          style={{ color: cssVar.colorError }}
          title={t('management.bulk.delete')}
          onClick={handleBatchDelete}
        />
        <span className={styles.divider} />
        <ActionIcon
          aria-label={t('management.bulk.cancel')}
          disabled={busy}
          icon={X}
          size={'small'}
          title={t('management.bulk.cancel')}
          onClick={exitSelectMode}
        />
      </Flexbox>
    </div>
  );
});

BulkActionBar.displayName = 'AgentTopicManagerBulkActionBar';

export default BulkActionBar;
