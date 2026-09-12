import { expect, it } from 'vitest';

import { DEFAULT_AGENT_LIST_VIEW_OPTIONS as defaults } from '@/features/AgentViewAll/listViewOptions';

import { getGroupMemberSections } from './groupMembersView';

const members = [
  { id: 'a', title: 'Alice', updatedAt: '2026-01-01', tags: ['旅行'] },
  { id: 'b', title: 'Bob', updatedAt: '2026-03-01', tags: ['旅行', '创作'] },
  { id: 'c', title: 'Carol', updatedAt: '2026-02-01', tags: [] },
];
it('orders by actual update time in both directions', () => {
  expect(getGroupMemberSections(members, defaults)[0].items.map((x) => x.id)).toEqual([
    'b',
    'c',
    'a',
  ]);
  expect(
    getGroupMemberSections(members, { ...defaults, orderDirection: 'asc' })[0].items.map(
      (x) => x.id,
    ),
  ).toEqual(['a', 'c', 'b']);
});
it('sorts displayed names and groups actual tags without dropping untagged members', () => {
  const groups = getGroupMemberSections(members, {
    ...defaults,
    groupBy: 'label',
    orderBy: 'title',
    orderDirection: 'asc',
  });
  expect(groups.find((x) => x.label === '旅行')?.items.map((x) => x.id)).toEqual(['a', 'b']);
  expect(groups.find((x) => x.label === '')?.items.map((x) => x.id)).toEqual(['c']);
  expect(members.map((x) => x.id)).toEqual(['a', 'b', 'c']);
});
