import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import PanelContent from '../UserPanel/PanelContent';

const creditQuery = vi.hoisted(() => ({
  data: { remainingCredits: 2_500_000, totalCredits: 5_000_000 } as
    { remainingCredits: number; totalCredits: number } | undefined,
  isError: false,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: { platformCredit: { getOwnRegistrationCredits: { useQuery: () => creditQuery } } },
}));

// Mock dependencies
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
  })),
}));

vi.mock('@/components/Menu', () => ({
  default: vi.fn(({ items, onClick }) => (
    <div>
      Mocked Menu
      {items.map((item: any) => (
        <button key={item.key} type={'button'} onClick={() => onClick({ key: item.key })}>
          {item.label}
        </button>
      ))}
    </div>
  )),
}));

vi.mock('../UserInfo', () => ({
  default: vi.fn(({ onClick }) => (
    <button type={'button'} onClick={onClick}>
      Mocked UserInfo
    </button>
  )),
}));

vi.mock('../UserPanel/useMenu', () => ({
  useMenu: vi.fn(() => ({
    logoutItems: [{ key: 'logout', label: 'Logout' }],
    mainItems: [
      { key: 'item1', label: 'Main Item 1' },
      { key: 'item2', label: 'Main Item 2' },
    ],
  })),
}));

vi.mock('../UserLoginOrSignup', () => ({
  default: vi.fn(({ onClick }) => (
    <button type={'button'} onClick={onClick}>
      Mocked SignInBlock
    </button>
  )),
}));

vi.mock('../UserPanel/LangButton', () => ({
  default: () => <div>Language chooser</div>,
}));

vi.mock('../DataStatistics', () => ({
  default: vi.fn(() => <div>Mocked DataStatistics</div>),
}));

vi.mock('@/const/version', () => ({
  isDeprecatedEdition: false,
  isDesktop: false,
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableBusinessFeatures: () => false,
  },
  useServerConfigStore: (selector: (s: unknown) => unknown) => selector({}),
}));

describe('PanelContent', () => {
  beforeEach(() => {
    creditQuery.data = { remainingCredits: 2_500_000, totalCredits: 5_000_000 };
    creditQuery.isError = false;
  });
  const closePopover = vi.fn();

  // Helper function to render component with Router provider
  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
  };

  describe('enable auth', () => {
    it('does not show a full gift for loading, failed requests, or accounts without a grant', () => {
      act(() => {
        useUserStore.setState({ isSignedIn: true });
      });
      creditQuery.data = undefined;
      const view = renderWithRouter(<PanelContent closePopover={closePopover} />);
      expect(screen.getByText('— / —')).toBeInTheDocument();
      for (const bar of screen.getAllByRole('progressbar')) {
        expect(bar).not.toHaveAttribute('aria-valuenow');
      }
      creditQuery.data = { remainingCredits: 5_000_000, totalCredits: 5_000_000 };
      creditQuery.isError = true;
      view.rerender(
        <MemoryRouter>
          <PanelContent closePopover={closePopover} />
        </MemoryRouter>,
      );
      expect(screen.getByText('— / —')).toBeInTheDocument();
      creditQuery.isError = false;
      creditQuery.data = { remainingCredits: 0, totalCredits: 0 };
      view.rerender(
        <MemoryRouter>
          <PanelContent closePopover={closePopover} />
        </MemoryRouter>,
      );
      expect(screen.getByText('0 / 0')).toBeInTheDocument();
      for (const bar of screen.getAllByRole('progressbar')) {
        expect(bar).toHaveAttribute('aria-valuenow', '0');
      }
    });
    it('should render UserInfo when user is signed in', () => {
      act(() => {
        useUserStore.setState({ isSignedIn: true });
      });

      renderWithRouter(<PanelContent closePopover={closePopover} />);

      expect(screen.getByText('Mocked UserInfo')).toBeInTheDocument();
      expect(screen.getByText('Mocked DataStatistics')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /免费积分/ })).toHaveAttribute(
        'href',
        '/settings/credits',
      );
      expect(screen.getByText('250万 / 500万')).toBeInTheDocument();
      for (const bar of screen.getAllByRole('progressbar')) {
        expect(bar).toHaveAttribute('aria-valuenow', '50');
      }
      expect(screen.queryByText('Mocked SignInBlock')).not.toBeInTheDocument();
    });

    it('keeps a long free-credit balance inside the narrow account panel', () => {
      act(() => {
        useUserStore.setState({ isSignedIn: true });
      });
      creditQuery.data = { remainingCredits: 4_786_000, totalCredits: 5_000_000 };

      renderWithRouter(<PanelContent closePopover={closePopover} />);

      const balance = screen.getByText('478.6万 / 500万');
      const valueGroup = balance.parentElement;
      const creditRow = valueGroup?.parentElement;

      expect(creditRow).toHaveStyle({ flexWrap: 'wrap' });
      expect(valueGroup).toHaveStyle({ marginInlineStart: 'auto' });
    });

    it('should render SignInBlock when user is not signed in and enable auth', () => {
      act(() => {
        useUserStore.setState({ isSignedIn: false });
      });

      renderWithRouter(<PanelContent closePopover={closePopover} />);

      expect(screen.getByText('Mocked SignInBlock')).toBeInTheDocument();
      expect(screen.queryByText('Mocked DataStatistics')).not.toBeInTheDocument();
      expect(screen.queryByText('Mocked UserInfo')).not.toBeInTheDocument();
    });

    it('should render profile actions in a single menu when user is signed in', () => {
      act(() => {
        useUserStore.setState({ isSignedIn: true });
      });

      renderWithRouter(<PanelContent closePopover={closePopover} />);

      expect(screen.getAllByText('Mocked Menu')).toHaveLength(1);
      expect(screen.getByText('Logout')).toBeInTheDocument();
    });

    it('should render SignInBlock when user is not signed in', () => {
      act(() => {
        useUserStore.setState({ isSignedIn: false });
      });

      renderWithRouter(<PanelContent closePopover={closePopover} />);

      expect(screen.getByText('Mocked SignInBlock')).toBeInTheDocument();
    });
  });

  it('should render Menu with main items', () => {
    renderWithRouter(<PanelContent closePopover={closePopover} />);

    expect(screen.getAllByText('Mocked Menu').length).toBeGreaterThan(0);
    expect(screen.queryByText('Language chooser')).not.toBeInTheDocument();
  });
});
