/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter, type NavigateFunction } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Nav from './Nav';

const mocks = vi.hoisted(() => ({
  scrollIntoView: vi.fn(),
  toggleCommandMenu: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ active, title }: { active?: boolean; title: ReactNode }) => (
    <div data-active={active ? 'true' : undefined} data-nav-item="">
      {title}
    </div>
  ),
}));

vi.mock('@/features/NavPanel/ToggleLeftPanelButton', () => ({
  default: () => <button type="button">toggle sidebar</button>,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', async () => {
  const { useNavigate } = await vi.importActual<{ useNavigate: () => NavigateFunction }>(
    'react-router',
  );
  return { useWorkspaceAwareNavigate: useNavigate };
});

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { toggleCommandMenu: typeof vi.fn }) => unknown) =>
    selector({ toggleCommandMenu: mocks.toggleCommandMenu }),
}));

describe('mobile memory navigation', () => {
  beforeEach(() => {
    mocks.scrollIntoView.mockClear();
    mocks.toggleCommandMenu.mockClear();

    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: mocks.scrollIntoView,
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.getAttribute('aria-current') === 'page') {
        return {
          bottom: 44,
          height: 44,
          left: 320,
          right: 400,
          top: 0,
          width: 80,
          x: 320,
          y: 0,
          toJSON: () => undefined,
        };
      }

      return {
        bottom: 44,
        height: 44,
        left: 0,
        right: 240,
        top: 0,
        width: 240,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      };
    });
  });

  it('scrolls a newly selected off-screen tab into the mobile navigation viewport', async () => {
    render(
      <MemoryRouter initialEntries={['/memory']}>
        <Nav horizontal />
      </MemoryRouter>,
    );

    mocks.scrollIntoView.mockClear();
    fireEvent.click(screen.getByRole('link', { name: 'tab.contexts' }));

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'tab.contexts' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
    expect(mocks.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'nearest',
      inline: 'center',
    });
  });
});
