import isEqual from 'fast-deep-equal';

import { useSidebarItemVisibility } from '@/features/HomeSidebar/Body/Agent/useSidebarItemVisibility';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/** Sidebar organization does not alter group membership or template order. */
export function useMemberSidebar() {
  const loggedIn = useUserStore(authSelectors.isLogin);
  const fetchAgents = useHomeStore((s) => s.useFetchAgentList);
  fetchAgents(loggedIn);
  const items = useHomeStore(homeAgentListSelectors.allAgents, isEqual);
  const groups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const privateGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
  const { isSidebarItemVisible } = useSidebarItemVisibility();
  return {
    category: (id: string, sessionGroupId?: string | null) =>
      [...groups, ...privateGroups].find(
        (group) => group.id === sessionGroupId || group.items.some((item) => item.id === id),
      )?.name,
    arrange: <T extends { id: string; pinned?: boolean | null }>(members: T[]) =>
      members
        .filter((member) => isSidebarItemVisible({ id: member.id, type: 'agent' }))
        .toSorted(
          (a, b) =>
            Number(b.pinned ?? !!items.find((item) => item.id === b.id)?.pinned) -
            Number(a.pinned ?? !!items.find((item) => item.id === a.id)?.pinned),
        ),
  };
}
