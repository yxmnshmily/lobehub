import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSortableMembers } from './useSortableMembers';

describe('useSortableMembers', () => {
  it('replaces the local roster when an open modal switches to another group', () => {
    const groupAMembers = [{ id: 'member-a', title: '西藏文案助理', virtual: true }] as any;
    const groupBMembers = [{ id: 'member-b', title: '封面美工助理', virtual: true }] as any;
    const { rerender, result } = renderHook(
      ({ groupId, members }) => useSortableMembers({ groupId, members, open: true }),
      { initialProps: { groupId: 'group-a', members: groupAMembers } },
    );

    act(() => result.current.setList([...groupAMembers].reverse()));
    rerender({ groupId: 'group-b', members: groupBMembers });

    expect(result.current.list).toEqual(groupBMembers);
  });
});
