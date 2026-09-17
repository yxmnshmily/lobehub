import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import OtherResources from './index';

vi.mock('./useOtherWorks', () => ({
  useOtherWorks: () => ({
    data: [
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
    ],
    mutate: vi.fn(),
  }),
}));
vi.mock('@/features/NavHeader', () => ({
  default: ({ left, right }: any) => (
    <header>
      {left}
      {right}
    </header>
  ),
}));
vi.mock('@/features/ResourceManager/hooks/useResourceManagerUrlSync', () => ({
  useResourceManagerUrlSync: vi.fn(),
}));
vi.mock('@/hooks/useFetchAgentList', () => ({ useFetchAgentList: vi.fn() }));
vi.mock('@/features/WorkGallery/useOpenWork', () => ({ useOpenWork: () => vi.fn() }));
vi.mock('@/features/WorkGallery/WorkPreviewCard', () => ({
  default: ({ item }: any) => <article>{item.title}</article>,
}));
vi.mock('@/services/work', () => ({ workService: { deleteWork: vi.fn() } }));
it('shows matching total, filters works, and selects the visible results in the top bar', () => {
  render(<OtherResources />);
  expect(screen.getByText('共 2 项')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: '全选作品' }));
  expect(screen.getByText('已选中 2 项')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: '全选作品' }));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索作品' }), {
    target: { value: 'Alpha' },
  });
  expect(screen.getByText('共 1 项')).toBeInTheDocument();
  expect(screen.queryByText('Beta')).toBeNull();
});
