/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, type NavigateFunction } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CategoryNav } from './Nav';

const mocks = vi.hoisted(() => ({
  scrollIntoView: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', async () => {
  const { useNavigate } = await vi.importActual<{ useNavigate: () => NavigateFunction }>(
    'react-router',
  );
  return { useWorkspaceAwareNavigate: useNavigate };
});

describe('mobile community category navigation', () => {
  beforeEach(() => {
    mocks.scrollIntoView.mockClear();

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

  it('scrolls a newly selected off-screen category into the mobile viewport', async () => {
    render(
      <MemoryRouter initialEntries={['/community']}>
        <CategoryNav />
      </MemoryRouter>,
    );

    mocks.scrollIntoView.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'tab.provider' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'tab.provider' })).toHaveAttribute(
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
