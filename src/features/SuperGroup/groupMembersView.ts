import type { AgentListViewOptions } from '@/features/AgentViewAll/listViewOptions';

export function getGroupMemberSections<
  T extends { title?: string | null; updatedAt?: Date | string; tags?: string[] | null },
>(items: T[], options: AgentListViewOptions): { label: string; items: T[] }[] {
  const direction = options.orderDirection === 'asc' ? 1 : -1;
  const sorted = [...items].sort(
    (a, b) =>
      direction *
      (options.orderBy === 'title'
        ? (a.title || '').localeCompare(b.title || '')
        : (new Date(a.updatedAt ?? 0).getTime() || 0) -
          (new Date(b.updatedAt ?? 0).getTime() || 0)),
  );
  if (options.groupBy !== 'label') return [{ label: '', items: sorted }];
  const groups = new Map<string, T[]>();
  for (const item of sorted) {
    const tags = [...new Set(item.tags?.filter(Boolean))];
    for (const label of tags.length ? tags : ['']) {
      const group = groups.get(label) ?? [];
      group.push(item);
      groups.set(label, group);
    }
  }
  return [...groups]
    .sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b)))
    .map(([label, members]) => ({ label, items: members }));
}
