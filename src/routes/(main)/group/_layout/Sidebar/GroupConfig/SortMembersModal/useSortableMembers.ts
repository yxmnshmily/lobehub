import { type AgentGroupMember } from '@lobechat/types';
import { useEffect, useRef, useState } from 'react';

interface UseSortableMembersOptions {
  groupId: string;
  members: AgentGroupMember[];
  open: boolean;
}

/**
 * Keeps the drag list optimistic while a reorder is in flight, but replaces it
 * whenever an already-open modal starts targeting another group.
 */
export const useSortableMembers = ({ groupId, members, open }: UseSortableMembersOptions) => {
  const [list, setList] = useState<AgentGroupMember[]>(members);
  const latestMembersRef = useRef(members);
  latestMembersRef.current = members;

  useEffect(() => {
    if (open) setList(latestMembersRef.current);
    // Depending directly on `members` would snap an optimistic drag back during refetch.
  }, [groupId, open]);

  return { list, setList };
};
