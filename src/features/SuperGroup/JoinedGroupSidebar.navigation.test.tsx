import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { expect, it, vi } from 'vitest';

import JoinedGroupSidebar from './JoinedGroupSidebar';

vi.mock('@/features/NavPanel/NavPanelPortal', () => ({
  NavPanelPortal: ({ children }: any) => children,
}));
vi.mock('@/features/NavPanel/SideBarLayout', () => ({ default: ({ body }: any) => body }));
vi.mock('@/store/global', () => ({ useGlobalStore: () => true }));
vi.mock('./GroupSidebarHeader', () => ({ default: () => null }));
vi.mock('./GroupSwitcher', () => ({ default: ({ children }: any) => children }));
vi.mock('./GroupSidebarSections', () => ({
  default: ({ onSelectTopic }: any) => (
    <button onClick={() => onSelectTopic('topic-1')}>历史话题</button>
  ),
}));

function Location() {
  const location = useLocation();
  return (
    <output>
      {location.pathname}
      {location.hash}
    </output>
  );
}

it('opens member topic anchors from the persistent sidebar without conversation context', () => {
  render(
    <MemoryRouter initialEntries={['/group/joined/profile']}>
      <JoinedGroupSidebar groupId="joined" />
      <Location />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: '历史话题' }));
  expect(screen.getByRole('status')).toHaveTextContent('/group/joined#topic-latest%3Atopic-1');
});
