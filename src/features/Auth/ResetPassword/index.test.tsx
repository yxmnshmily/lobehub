import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ResetPasswordPage from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  Navigate: () => null,
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, href }: { children: React.ReactNode; href?: string }) =>
    href ? <a href={href}>{children}</a> : <button>{children}</button>,
}));
vi.mock('@/features/AuthShell', () => ({
  useAuthServerConfigStore: () => false,
}));
vi.mock('@/features/AuthCard', () => ({
  default: ({ children, footer, subtitle, title }: React.PropsWithChildren<any>) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
      {footer}
    </main>
  ),
}));
vi.mock('./ResetPasswordContent', () => ({ ResetPasswordContent: () => <div /> }));

describe('ResetPasswordPage', () => {
  it('renders one mounted sign-in link instead of nested interactive controls', () => {
    window.history.replaceState({}, '', '/lobehub/reset-password');

    render(<ResetPasswordPage />);

    expect(
      screen.getByRole('link', { name: 'betterAuth.resetPassword.backToSignIn' }),
    ).toHaveAttribute('href', '/lobehub/signin');
    expect(
      screen.queryByRole('button', { name: 'betterAuth.resetPassword.backToSignIn' }),
    ).not.toBeInTheDocument();
  });
});
