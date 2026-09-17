'use client';

import { Button, toast } from '@lobehub/ui/base-ui';
import { useState } from 'react';

import { usePermission } from '@/hooks/usePermission';
import { useGoalStore } from '@/store/goal';
import { useTaskStore } from '@/store/task';

import type { GroupWorkKind } from './groupWorkEntries';

/** Shared by group cards and full details; all actions retain work and history. */
export default function WorkRunControls({
  id,
  kind,
  status,
  onChanged,
}: {
  id: string;
  kind: GroupWorkKind;
  status: string;
  onChanged?: () => void | Promise<unknown>;
}) {
  const { allowed } = usePermission('create_content');
  const pauseGoal = useGoalStore((s) => s.pauseGoal);
  const resumeGoal = useGoalStore((s) => s.resumeGoal);
  const cancelGoal = useGoalStore((s) => s.cancelGoal);
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const resumeTask = useTaskStore((s) => s.resumeTask);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const [busy, setBusy] = useState(false);
  const mutable =
    kind === 'goals'
      ? ['planning', 'running', 'verifying', 'review', 'paused', 'failed'].includes(status)
      : ['backlog', 'running', 'scheduled', 'paused', 'failed'].includes(status);
  if (!allowed || !mutable) return null;
  const paused = status === 'paused';
  const run = async (cancel: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === 'goals') {
        if (cancel) await cancelGoal(id);
        else if (paused) await resumeGoal(id);
        else await pauseGoal(id);
      } else if (cancel) await cancelTask(id);
      else if (paused) await resumeTask(id);
      else await updateTaskStatus(id, 'paused');
      await onChanged?.();
    } catch {
      toast.error('操作未完成，请重试');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {status !== 'failed' && (
        <Button disabled={busy} size="small" onClick={() => void run(false)}>
          {paused ? '继续' : '暂停'}
        </Button>
      )}
      <Button
        danger
        disabled={busy}
        size="small"
        title="停止执行，保留已有成果和记录"
        onClick={() => void run(true)}
      >
        {kind === 'goals' ? '取消目标' : '取消任务'}
      </Button>
    </div>
  );
}
