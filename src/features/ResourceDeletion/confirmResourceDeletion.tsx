import { confirmModal, toast } from '@lobehub/ui/base-ui';
import i18next, { t } from 'i18next';
import type { ReactNode } from 'react';

import { lambdaClient } from '@/libs/trpc/client';
import { clearResourceDeletionCache } from '@/services/resourceDeletionCache';
import { notifyFileCleanup, restorePendingFileCleanup } from '@/services/resourceDeletionCleanup';

type Resource = 'goal' | 'task' | 'project';
const labels = {
  title: ['确认永久删除', 'Confirm permanent deletion'],
  previewing: ['正在计算删除影响…', 'Calculating deletion impact…'],
  previewError: [
    '无法计算删除影响，未执行删除。请重试。',
    'Unable to calculate deletion impact. Nothing was deleted. Please retry.',
  ],
  deleteError: ['删除未完成，请重试。', 'Deletion failed. Please retry.'],
  changed: [
    '删除范围已变化，请重新查看数量后确认。',
    'The deletion scope changed. Review the updated counts and confirm again.',
  ],
  cleanupPending: ['内容已删除，文件清理待重试', 'Content deleted; file cleanup needs a retry'],
  retry: ['重试文件清理', 'Retry file cleanup'],
  cleanupDone: ['文件已永久清理', 'Files permanently removed'],
  description: [
    '以下为当前所选内容及其专属关联资源的实际数量。删除无法撤销；被其他内容共同使用的资源会保留。',
    'These are the actual counts for the selection and its exclusive resources. Deletion cannot be undone; resources shared with other content are retained.',
  ],
  resource: ['资源', 'Resource'],
  deleting: ['将永久删除', 'Permanently delete'],
  retained: ['共享资源保留', 'Shared resources retained'],
  goals: ['目标', 'Goals'],
  tasks: ['任务', 'Tasks'],
  topics: ['话题', 'Topics'],
  files: ['文件', 'Files'],
  cancel: ['取消', 'Cancel'],
  confirm: ['永久删除', 'Permanently delete'],
} as const;
const copy = (key: keyof typeof labels) =>
  t(`resourceDeletion.${key}`, {
    ns: 'common',
    defaultValue: labels[key][/^en(?:-|$)/i.test(i18next.language || '') ? 1 : 0],
  });
const pending = new Set<string>();
const resources = ['goals', 'tasks', 'topics', 'files'] as const;
interface Options {
  canProceed: () => boolean;
  ids: string[];
  onBusyChange?: (busy: boolean) => void;
  onOk: (cleanupPending: boolean) => void | Promise<void>;
  resource: Resource;
  title?: ReactNode;
}

/** A failed or stale preview never opens an actionable confirmation. */
export async function confirmResourceDeletion({
  resource,
  ids,
  canProceed,
  onOk,
  onBusyChange,
  title,
}: Options): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  const key = JSON.stringify([resource, [...uniqueIds].sort()]);
  if (!uniqueIds.length || !canProceed() || pending.has(key)) return;
  pending.add(key);
  void restorePendingFileCleanup();
  let confirming = false;
  const loading = toast.loading(copy('previewing'));
  try {
    const preview = await lambdaClient.resourceDeletion.preview.query({ resource, ids: uniqueIds });
    if (!canProceed()) return;
    if (
      !preview ||
      typeof preview.snapshot !== 'string' ||
      !preview.snapshot ||
      !resources.every((name) =>
        [preview.deleteCounts?.[name], preview.retainedCounts?.[name]].every(
          (count) => Number.isSafeInteger(count) && count >= 0,
        ),
      )
    )
      throw new Error('Invalid deletion preview');
    confirming = true;
    let deleting = false;
    confirmModal({
      title: title ?? copy('title'),
      content: (
        <div>
          <p>{copy('description')}</p>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'start',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <thead>
              <tr>
                <th scope="col">{copy('resource')}</th>
                <th scope="col">{copy('deleting')}</th>
                <th scope="col">{copy('retained')}</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((name) => (
                <tr key={name}>
                  <th scope="row" style={{ paddingBlock: 8, fontWeight: 400 }}>
                    {copy(name)}
                  </th>
                  <td>{preview.deleteCounts[name]}</td>
                  <td>{preview.retainedCounts[name]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
      cancelText: copy('cancel'),
      okText: copy('confirm'),
      okButtonProps: { danger: true },
      onCancel: () => {
        pending.delete(key);
      },
      onOk: async () => {
        if (!canProceed()) {
          pending.delete(key);
          return;
        }
        if (deleting) return;
        deleting = true;
        onBusyChange?.(true);
        try {
          const result = await lambdaClient.resourceDeletion.delete.mutate({
            resource,
            ids: uniqueIds,
            snapshot: preview.snapshot,
          });
          const cleanupPending = result.deletion.storageCleanup?.status === 'pending';
          try {
            if (canProceed()) await onOk(cleanupPending);
          } finally {
            await clearResourceDeletionCache(result.deletion);
          }
          notifyFileCleanup(result.deletion.storageCleanup);
        } catch (error) {
          const code = (error as { data?: { code?: string } }).data?.code;
          if (code === 'CONFLICT' || code === 'PRECONDITION_FAILED') {
            toast.error(copy('changed'));
            pending.delete(key);
            if (canProceed())
              await confirmResourceDeletion({
                resource,
                ids,
                canProceed,
                onOk,
                onBusyChange,
                title,
              });
          } else {
            toast.error(copy('deleteError'));
            throw error;
          }
        } finally {
          deleting = false;
          onBusyChange?.(false);
          pending.delete(key);
        }
      },
    });
  } catch {
    if (canProceed()) toast.error(copy('previewError'));
  } finally {
    loading.close();
    if (!confirming) pending.delete(key);
  }
}
