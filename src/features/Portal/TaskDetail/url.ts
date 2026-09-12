import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

interface TaskDetailPageUrlOptions {
  agentId?: string;
  appOrigin?: string;
  groupId?: string;
  taskId?: string;
  workspaceSlug?: string | null;
}

export const getTaskDetailPageUrl = ({
  agentId,
  appOrigin,
  groupId,
  taskId,
  workspaceSlug,
}: TaskDetailPageUrlOptions): string | undefined => {
  if (!appOrigin || !taskId) return;

  const target = groupId
    ? `/group/${encodeURIComponent(groupId)}/task/${encodeURIComponent(taskId)}`
    : taskDetailPath(taskId, agentId);
  const path = buildWorkspaceAwarePath(target, workspaceSlug);
  return `${appOrigin}${path}`;
};
