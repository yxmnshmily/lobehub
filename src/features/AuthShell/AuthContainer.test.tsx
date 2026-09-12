import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AuthContainer from './AuthContainer';

const sessionState = vi.hoisted(() => ({
  data: null as null | { user: { id: string } },
  isPending: false,
}));
vi.mock('@/libs/better-auth/auth-client', () => ({ useSession: () => sessionState }));

beforeEach(() => {
  sessionState.data = null;
  sessionState.isPending = false;
  window.history.replaceState({}, '', '/lobehub/signin');
  vi.spyOn(window.location, 'replace').mockImplementation(() => {});
});

vi.mock('@lobehub/ui', () => ({
  Center: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div data-testid="auth-scroll-region" style={style}>
      {children}
    </div>
  ),
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('antd', () => ({ Divider: () => <span /> }));
vi.mock('antd-style', () => ({ cx: (...values: string[]) => values.join(' ') }));
vi.mock('@/hooks/useIsDark', () => ({ useIsDark: () => false }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (key: string) =>
      ({
        'betterAuth.signin.emailStep.title': '登录',
        'betterAuth.signup.title': '创建账号',
      })[key] || key,
  }),
}));
vi.mock('./AuthFooterLinks', () => ({ default: () => null }));
vi.mock('./AuthLangButton', () => ({ default: () => null }));
vi.mock('./AuthThemeButton', () => ({ default: () => null }));
vi.mock('./style', () => ({
  styles: { divider: '', innerContainerDark: '', innerContainerLight: '', outerContainer: '' },
}));

afterEach(() => {
  document.title = '';
  vi.restoreAllMocks();
});

const AuthRouteHarness = () => {
  const navigate = useNavigate();

  return (
    <AuthContainer>
      <button type="button" onClick={() => navigate('/signup')}>
        signup
      </button>
    </AuthContainer>
  );
};

describe('AuthContainer', () => {
  it('does not mount the login form while the session is being checked', () => {
    sessionState.isPending = true;
    render(
      <MemoryRouter initialEntries={['/signin']}>
        <AuthContainer>login form</AuthContainer>
      </MemoryRouter>,
    );
    expect(screen.queryByText('login form')).toBeNull();
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it.each(['/signin', '/signup'])(
    'returns a signed-in visitor from %s to the original destination',
    (path) => {
      sessionState.data = { user: { id: 'signed-in-user' } };
      render(
        <MemoryRouter initialEntries={[`${path}?callbackUrl=%2Flobehub%2Fsettings%2Fplans`]}>
          <AuthContainer>login form</AuthContainer>
        </MemoryRouter>,
      );
      expect(window.location.replace).toHaveBeenCalledWith('/lobehub/settings/plans');
      expect(screen.queryByText('login form')).toBeNull();
    },
  );

  it.each([
    'https://evil.example/',
    '//evil.example',
    '/foo/..//evil.example',
    '/signin',
    '/lobehub/signup?callbackUrl=/signin',
    '/lobehub/foo/../signin',
    '/%73ignin',
  ])('rejects unsafe or looping callback %s', (callback) => {
    sessionState.data = { user: { id: 'signed-in-user' } };
    render(
      <MemoryRouter initialEntries={[`/signin?callbackUrl=${encodeURIComponent(callback)}`]}>
        <AuthContainer>login form</AuthContainer>
      </MemoryRouter>,
    );
    expect(window.location.replace).toHaveBeenCalledWith('/lobehub/group/default');
  });

  it('preserves a callback to the public website without adding the app mount', () => {
    sessionState.data = { user: { id: 'signed-in-user' } };
    render(
      <MemoryRouter initialEntries={['/signin?callbackUrl=%2Findex.html']}>
        <AuthContainer>login form</AuthContainer>
      </MemoryRouter>,
    );
    expect(window.location.replace).toHaveBeenCalledWith('/index.html');
  });

  it('leaves password recovery and verification pages accessible to signed-in users', () => {
    sessionState.data = { user: { id: 'signed-in-user' } };
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <AuthContainer>recovery form</AuthContainer>
      </MemoryRouter>,
    );
    expect(screen.getByText('recovery form')).toBeInTheDocument();
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it('does not interrupt a guest form when its own sign-up flow establishes a session', () => {
    const view = render(
      <MemoryRouter initialEntries={['/signup']}>
        <AuthContainer>signup form</AuthContainer>
      </MemoryRouter>,
    );
    expect(screen.getByText('signup form')).toBeInTheDocument();
    sessionState.data = { user: { id: 'new-user' } };
    view.rerender(
      <MemoryRouter initialEntries={['/signup']}>
        <AuthContainer>signup form</AuthContainer>
      </MemoryRouter>,
    );
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(screen.getByText('signup form')).toBeInTheDocument();
  });
  it('does not render the brand logo on auth pages', () => {
    render(
      <MemoryRouter initialEntries={['/signin']}>
        <AuthContainer>content</AuthContainer>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: '旅游群网' })).toBeNull();
    expect(screen.queryByRole('img', { name: '旅游群网' })).toBeNull();
  });

  it('updates the browser title when SPA navigation moves from sign in to sign up', async () => {
    render(
      <MemoryRouter initialEntries={['/signin']}>
        <AuthRouteHarness />
      </MemoryRouter>,
    );

    await waitFor(() => expect(document.title).toBe('登录 · 旅游群网'));
    fireEvent.click(screen.getByRole('button', { name: 'signup' }));
    await waitFor(() => expect(document.title).toBe('创建账号 · 旅游群网'));
  });

  it('falls back to start alignment when a short mobile viewport cannot fit the form', () => {
    render(
      <MemoryRouter initialEntries={['/signup']}>
        <AuthContainer>content</AuthContainer>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('auth-scroll-region')).toHaveStyle({
      justifyContent: 'safe center',
    });
  });
});
