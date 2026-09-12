import type { UIChatMessage } from '@lobechat/types';

export type GroupWorkKind = 'goals' | 'tasks';

export const getGroupWorkKind = (tool: {
  apiName: string;
  identifier: string;
}): GroupWorkKind | undefined => {
  if (['lobe-goal', 'lobe-task'].includes(tool.identifier) && tool.apiName === 'createGoal')
    return 'goals';
  if (
    tool.identifier === 'lobe-group-management' &&
    ['executeAgentTask', 'executeAgentTasks'].includes(tool.apiName)
  )
    return 'tasks';
  return undefined;
};

/** Only consumes this conversation's authorized display messages, never the user's global lists. */
export const collectGroupWorkEntries = (messages: UIChatMessage[]) => {
  const result: Record<GroupWorkKind, UIChatMessage[]> = { goals: [], tasks: [] };
  const seen = new Set<string>();
  const collect = (message: UIChatMessage) => {
    if (seen.has(message.id)) return;
    seen.add(message.id);
    const kinds = new Set<GroupWorkKind>();
    if (['task', 'tasks', 'groupTasks'].includes(message.role)) kinds.add('tasks');
    const tools = [
      ...(message.plugin ? [message.plugin] : []),
      ...(message.children ?? []).flatMap((block) => block.tools ?? []),
    ];
    for (const tool of tools) {
      const kind = getGroupWorkKind(tool);
      if (kind) kinds.add(kind);
    }
    for (const kind of kinds) result[kind].push(message);
    message.compressedMessages?.forEach(collect);
  };
  messages.forEach(collect);
  return result;
};

export const getGroupWorkPanelBounds = (
  body: { height: number; left: number; top: number; width: number },
  anchorTop: number,
) => {
  const width = (body.width * 2) / 3;
  const height = Math.max(0, Math.min((body.height * 2) / 3, anchorTop - body.top - 8));
  return { height, left: body.left + (body.width - width) / 2, top: anchorTop - height - 8, width };
};
