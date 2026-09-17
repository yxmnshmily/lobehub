import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { getResourceQueryVisibility } from '@/features/ResourceManager/store/selectors';
import { useClientDataSWR } from '@/libs/swr';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { workService, type WorkSummaryPage } from '@/services/work';

export async function fetchOtherWorks(visibility?: 'private' | 'public') {
  const items = new Map<string, WorkSummaryPage['items'][number]>();
  let cursor: string | undefined;
  do {
    const page = await workService.listByWorkspace({
      type: 'document',
      limit: 100,
      cursor,
      visibility,
    });
    for (const item of page.items) items.set(item.id, item);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return [...items.values()];
}

export function useOtherWorks() {
  const workspaceId = useActiveWorkspaceId();
  const scope = useCacheScope();
  const listVisibility = useResourceManagerStore((s) => s.listVisibility);
  const visibility = workspaceId
    ? getResourceQueryVisibility(undefined, listVisibility)
    : undefined;
  return useClientDataSWR(
    ['work', 'resource-other', scope, visibility ?? null],
    () => fetchOtherWorks(visibility),
    {
      suspense: false,
      revalidateOnFocus: true,
    },
  );
}
