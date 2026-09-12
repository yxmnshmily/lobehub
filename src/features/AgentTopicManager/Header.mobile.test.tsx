import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import Header from './Header';

vi.mock('@/features/NavPanel/ToggleLeftPanelButton', () => ({
  default: () => <button aria-label="切换侧栏" />,
  isMacDesktop: false,
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => true }));

it('does not reserve another sidebar toggle inside the mobile group topic header', () => {
  render(<Header agentId="" breadcrumb={<span>群主页</span>} />);

  expect(screen.getByText('群主页')).toBeVisible();
  expect(screen.queryByRole('button', { name: '切换侧栏' })).toBeNull();
  expect(screen.getByPlaceholderText(/search|topic|搜索/i)).toBeVisible();
});
