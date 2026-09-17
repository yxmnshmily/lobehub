import { confirmModal, toast } from '@lobehub/ui/base-ui';
import i18next, { t } from 'i18next';

import { lambdaClient } from '@/libs/trpc/client';

interface CleanupState {
  jobId: string;
  status: 'completed' | 'pending';
}
const labels = {
  cleanupPending: ['内容已删除，文件清理待重试', 'Content deleted; file cleanup needs a retry'],
  retry: ['重试文件清理', 'Retry file cleanup'],
  cleanupDone: ['文件已永久清理', 'Files permanently removed'],
  cancel: ['取消', 'Cancel'],
} as const;
const copy = (key: keyof typeof labels) =>
  t(`resourceDeletion.${key}`, {
    ns: 'common',
    defaultValue: labels[key][/^en(?:-|$)/i.test(i18next.language || '') ? 1 : 0],
  });

/** Deletion already committed: retry only the outstanding physical cleanup job. */
export const notifyFileCleanup = (cleanup?: CleanupState): boolean => {
  if (cleanup?.status !== 'pending') return false;
  confirmModal({
    title: copy('cleanupPending'),
    content: copy('cleanupPending'),
    cancelText: copy('cancel'),
    okText: copy('retry'),
    onOk: async () => {
      try {
        const result = await lambdaClient.resourceDeletion.retryCleanup.mutate({
          jobId: cleanup.jobId,
        });
        if (result.storageCleanup.status !== 'completed') throw new Error('File cleanup pending');
        toast.success(copy('cleanupDone'));
      } catch (error) {
        toast.error(copy('cleanupPending'));
        throw error;
      }
    },
  });
  return true;
};

/** Recover durable cleanup jobs on a user action, without background polling. */
export const restorePendingFileCleanup = async (): Promise<void> => {
  try {
    const result = await lambdaClient.resourceDeletion.retryPendingCleanup.mutate();
    for (const cleanup of result.storageCleanups) notifyFileCleanup(cleanup);
  } catch (error) {
    console.error('[resourceDeletion] Pending cleanup retry failed', error);
    toast.error(copy('cleanupPending'));
  }
};
