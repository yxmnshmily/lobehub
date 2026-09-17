import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { useGroupDeletePermission } from './useGroupDeletePermission';

const state = vi.hoisted(() => ({
  error: false,
  groups: [
    { groupId: 'own', kind: 'owner' },
    { groupId: 'joined', kind: 'member' },
  ],
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupConversation: {
      listGroups: { useQuery: () => ({ isError: state.error, data: state.groups }) },
    },
  },
}));
it('allows only group owner, denies joined/error, and preserves standalone permission', () => {
  const { result, rerender } = renderHook(
    ({ group, allowed }) => useGroupDeletePermission(allowed, group),
    { initialProps: { group: 'own' as string | undefined, allowed: true } },
  );
  expect(result.current.canDelete).toBe(true);
  const oldConfirm = result.current.checkDeletePermission;
  rerender({ group: 'joined', allowed: true });
  expect(result.current.canDelete).toBe(false);
  expect(oldConfirm()).toBe(false);
  rerender({ group: undefined, allowed: true });
  expect(result.current.canDelete).toBe(true);
  rerender({ group: undefined, allowed: false });
  expect(result.current.canDelete).toBe(false);
  state.error = true;
  rerender({ group: 'own', allowed: true });
  expect(result.current.canDelete).toBe(false);
  state.error = false;
});
it('invalidates old confirmation when group ownership is lost or component unmounts', () => {
  const { result, rerender, unmount } = renderHook(() => useGroupDeletePermission(true, 'own'));
  const confirm = result.current.checkDeletePermission;
  expect(confirm()).toBe(true);
  state.groups = [{ groupId: 'own', kind: 'member' }];
  rerender();
  expect(confirm()).toBe(false);
  state.groups = [
    { groupId: 'own', kind: 'owner' },
    { groupId: 'joined', kind: 'member' },
  ];
  rerender();
  expect(confirm()).toBe(true);
  unmount();
  expect(confirm()).toBe(false);
});
