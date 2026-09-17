import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { confirmResourceDeletion } from './confirmResourceDeletion';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  retry: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
  language: 'zh-CN',
}));
vi.mock('@/services/resourceDeletionCache', () => ({ clearResourceDeletionCache: mocks.clear }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    resourceDeletion: {
      retryPendingCleanup: { mutate: vi.fn().mockResolvedValue({ storageCleanups: [] }) },
      preview: { query: mocks.query },
      delete: { mutate: mocks.remove },
      retryCleanup: { mutate: mocks.retry },
    },
  },
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: mocks.confirm,
  toast: { success: vi.fn(), error: mocks.error, loading: () => ({ close: vi.fn() }) },
}));
vi.mock('i18next', () => ({
  default: {
    get language() {
      return mocks.language;
    },
  },
  t: (_key: string, options: any) => options.defaultValue,
}));
const counts = {
  snapshot: 'snapshot-1',
  deleteCounts: { goals: 2, tasks: 3, topics: 4, files: 5 },
  retainedCounts: { goals: 0, tasks: 1, topics: 2, files: 3 },
};
beforeEach(() => {
  for (const [modal] of mocks.confirm.mock.calls) modal.onCancel?.();
  mocks.remove.mockReset().mockResolvedValue({ deletion: {} });
  mocks.retry.mockReset().mockResolvedValue({ storageCleanup: { status: 'completed' } });
  mocks.query.mockReset().mockResolvedValue(counts);
  mocks.confirm.mockReset();
  mocks.error.mockReset();
  mocks.language = 'zh-CN';
});
it('previews the whole selection once and shows actual deletion and retained counts in Chinese before confirmation', async () => {
  const onOk = vi.fn();
  await confirmResourceDeletion({
    resource: 'goal',
    ids: ['g1', 'g2', 'g1'],
    canProceed: () => true,
    onOk,
  });
  expect(mocks.query).toHaveBeenCalledWith({ resource: 'goal', ids: ['g1', 'g2'] });
  expect(onOk).not.toHaveBeenCalled();
  render(mocks.confirm.mock.calls[0][0].content);
  expect(screen.getByText('目标')).toBeVisible();
  expect(screen.getByText('将永久删除')).toBeVisible();
  expect(screen.getByText('共享资源保留')).toBeVisible();
  expect(screen.getByText('5')).toBeVisible();
  await mocks.confirm.mock.calls[0][0].onOk();
  expect(onOk).toHaveBeenCalledWith(false);
  expect(mocks.remove).toHaveBeenCalledWith({
    resource: 'goal',
    ids: ['g1', 'g2'],
    snapshot: 'snapshot-1',
  });
});
it('fails closed on preview error and permits a later retry', async () => {
  mocks.query.mockRejectedValueOnce(new Error('server unavailable'));
  const onOk = vi.fn();
  await confirmResourceDeletion({ resource: 'task', ids: ['T1'], canProceed: () => true, onOk });
  expect(mocks.error).toHaveBeenCalled();
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(onOk).not.toHaveBeenCalled();
  await confirmResourceDeletion({ resource: 'task', ids: ['T1'], canProceed: () => true, onOk });
  expect(mocks.confirm).toHaveBeenCalledOnce();
});
it('deduplicates pending preview and blocks stale scope both after preview and on confirmation', async () => {
  let finish!: (value: typeof counts) => void;
  mocks.query.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let allowed = true;
  const onOk = vi.fn();
  const options = { resource: 'project' as const, ids: ['p1'], canProceed: () => allowed, onOk };
  const pending = confirmResourceDeletion(options);
  await confirmResourceDeletion(options);
  expect(mocks.query).toHaveBeenCalledOnce();
  allowed = false;
  finish(counts);
  await pending;
  expect(mocks.confirm).not.toHaveBeenCalled();
  allowed = true;
  mocks.query.mockResolvedValue(counts);
  await confirmResourceDeletion(options);
  allowed = false;
  await mocks.confirm.mock.calls[0][0].onOk();
  expect(onOk).not.toHaveBeenCalled();
});
it('uses English labels only for the English interface', async () => {
  mocks.language = 'en-US';
  await confirmResourceDeletion({
    resource: 'goal',
    ids: ['g'],
    canProceed: () => true,
    onOk: vi.fn(),
  });
  render(mocks.confirm.mock.calls[0][0].content);
  expect(screen.getByText('Permanently delete')).toBeVisible();
  expect(screen.getByText('Shared resources retained')).toBeVisible();
});

it('requires a new preview confirmation when the deletion snapshot changed', async () => {
  mocks.remove.mockRejectedValueOnce({ data: { code: 'CONFLICT' } });
  const onOk = vi.fn();
  await confirmResourceDeletion({
    resource: 'goal',
    ids: ['changed'],
    canProceed: () => true,
    onOk,
  });
  await mocks.confirm.mock.calls[0][0].onOk();
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.confirm).toHaveBeenCalledTimes(2);
  expect(onOk).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledTimes(1);
});
it('reports pending file cleanup separately and retries only its cleanup job', async () => {
  mocks.remove.mockResolvedValue({
    deletion: { storageCleanup: { status: 'pending', jobId: 'job1' } },
  });
  const onOk = vi.fn();
  await confirmResourceDeletion({
    resource: 'project',
    ids: ['cleanup'],
    canProceed: () => true,
    onOk,
  });
  await mocks.confirm.mock.calls[0][0].onOk();
  expect(onOk).toHaveBeenCalledWith(true);
  expect(mocks.confirm.mock.calls[1][0].title).toBe('内容已删除，文件清理待重试');
  await mocks.confirm.mock.calls[1][0].onOk();
  expect(mocks.retry).toHaveBeenCalledWith({ jobId: 'job1' });
});

afterEach(() => {
  for (const [modal] of mocks.confirm.mock.calls) modal.onCancel?.();
});

it('keeps cleanup pending when retry has not completed', async () => {
  mocks.remove.mockResolvedValue({
    deletion: { storageCleanup: { status: 'pending', jobId: 'job2' } },
  });
  mocks.retry.mockResolvedValue({ storageCleanup: { status: 'pending', jobId: 'job2' } });
  await confirmResourceDeletion({
    resource: 'project',
    ids: ['cleanup-pending'],
    canProceed: () => true,
    onOk: vi.fn(),
  });
  await mocks.confirm.mock.calls[0][0].onOk();
  await expect(mocks.confirm.mock.calls[1][0].onOk()).rejects.toThrow('File cleanup pending');
  expect(mocks.error).toHaveBeenCalledWith('内容已删除，文件清理待重试');
});
