import type { WorkSummaryItem } from '@lobechat/types';

import type { ResourceItem } from '@/types/resource';

export type OtherResourceEntry =
  { item: ResourceItem; kind: 'resource' } | { item: WorkSummaryItem; kind: 'work' };

/** Keep one card for a persisted artifact also registered as a Work. */
export const mergeOtherResources = (resources: ResourceItem[], works: WorkSummaryItem[]) => {
  const workFileIds = new Set(
    works
      .filter((work) => work.resourceType === 'file')
      .map((work) => work.event.metadata?.fileId)
      .filter(Boolean),
  );
  const entries: OtherResourceEntry[] = [
    ...resources
      .filter((item) => !workFileIds.has(item.fileId ?? item.id))
      .map((item): OtherResourceEntry => ({ item, kind: 'resource' })),
    ...works.map((item): OtherResourceEntry => ({ item, kind: 'work' })),
  ];
  return entries.sort(
    (a, b) =>
      new Date(b.item.updatedAt).getTime() - new Date(a.item.updatedAt).getTime() ||
      a.item.id.localeCompare(b.item.id),
  );
};
