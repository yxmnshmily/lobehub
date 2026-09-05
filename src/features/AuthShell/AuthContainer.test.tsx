import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AuthContainer from './AuthContainer';

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
