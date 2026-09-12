import { isIndependentGroupRequest } from '../../apps/server/src/services/groupConversationAccess/independentRequest';

export interface HistoryMessage {
  content: string | null;
  created_at: Date;
  group_id: string | null;
  id: string;
  parent_id: string | null;
  role: string;
  thread_id: string | null;
}

export function planHistoryTopics(
  topicId: string,
  groupId: string,
  rows: HistoryMessage[],
  threads: { id: string; source_message_id: string | null }[],
): { boundaries: HistoryMessage[]; messageAnchors: Map<string, string | null> } {
  const boundaries: HistoryMessage[] = [];
  const roots = new Map<string, string | null>();
  let anchor: string | null = null;
  for (const row of rows) {
    if (row.role !== 'user' || row.thread_id || row.group_id !== groupId) continue;
    if (roots.size && isIndependentGroupRequest(row.content ?? '')) {
      boundaries.push(row);
      anchor = row.id;
    }
    roots.set(row.id, anchor);
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const threadSources = new Map(threads.map((row) => [row.id, row.source_message_id]));
  const resolving = new Set<string>();
  const resolve = (id: string): string | null => {
    if (roots.has(id)) return roots.get(id)!;
    const row = byId.get(id);
    if (!row || resolving.has(id))
      throw new Error(`Unresolved history relation in ${topicId}: ${id}`);
    resolving.add(id);
    const parent = row.thread_id ? threadSources.get(row.thread_id) : row.parent_id;
    if (!parent) throw new Error(`Unresolved history relation in ${topicId}: ${id}`);
    const resolved = resolve(parent);
    resolving.delete(id);
    roots.set(id, resolved);
    return resolved;
  };
  return { boundaries, messageAnchors: new Map(rows.map((row) => [row.id, resolve(row.id)])) };
}
