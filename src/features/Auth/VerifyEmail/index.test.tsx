import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VerifyEmailPage from './index';

const mocks = vi.hoisted(() => ({
  search: '',
  session: null as null | { user: { emailVerified: boolean } },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useSearchParams: () => [new URLSearchParams(mocks.search)],
}));
vi.mock('@/libs/better-auth/auth-client', () => ({
  useSession: () => ({ data: mocks.session, isPending: false }),
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, href }: { children: React.ReactNode; href?: string }) =>
    href ? <a href={href}>{children}</a> : <button>{children}</button>,
}));
vi.mock('@/features/AuthCard', () => ({
  default: ({
    children,
    footer,
    subtitle,
    title,
  }: {
    children: React.ReactNode;
    footer: React.ReactNode;
    subtitle: React.ReactNode;
    title: React.ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
      {footer}
    </main>
  ),
}));
vi.mock('./VerifyEmailContent', () => ({
  VerifyEmailContent: () => <div>resend-control</div>,
}));

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    mocks.search = '';
    mocks.session = null;
    window.history.replaceState(null, '', '/lobehub/verify-email');
  });

  it('shows a clear success state and safe continuation target', () => {
    mocks.search = 'status=success&callbackUrl=%2Flobehub%2Fonboarding&email=member%40example.test';
    mocks.session = { user: { emailVerified: true } };

    render(<VerifyEmailPage />);

    expect(screen.getByRole('heading')).toHaveTextContent('betterAuth.verifyEmail.success.title');
    expect(screen.getByText('betterAuth.verifyEmail.success.description')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/lobehub/onboarding');
    expect(screen.queryByText('resend-control')).not.toBeInTheDocument();
  });

  it('shows an understandable expired-link state without rendering technical details', () => {
    mocks.search =
      'error=INVALID_VERIFICATION_TOKEN&callbackUrl=%2Flobehub%2Fonboarding&token=secret-fixture';

    render(<VerifyEmailPage />);

    expect(screen.getByRole('heading')).toHaveTextContent('betterAuth.verifyEmail.expired.title');
    expect(screen.getByText('betterAuth.verifyEmail.expired.description')).toBeInTheDocument();
    expect(screen.queryByText(/INVALID_VERIFICATION_TOKEN|secret-fixture/)).not.toBeInTheDocument();
  });

  it('renders one mounted sign-in link instead of nested interactive controls', () => {
    mocks.search = 'error=INVALID_VERIFICATION_TOKEN';

    render(<VerifyEmailPage />);

    expect(
      screen.getByRole('link', { name: 'betterAuth.verifyEmail.backToSignIn' }),
    ).toHaveAttribute('href', '/lobehub/signin');
    expect(
      screen.queryByRole('button', { name: 'betterAuth.verifyEmail.backToSignIn' }),
    ).not.toBeInTheDocument();
  });

  it('lets a safe error state override an untrusted success query value', () => {
    mocks.search = 'status=success&error=INVALID_VERIFICATION_TOKEN';

    render(<VerifyEmailPage />);

    expect(screen.getByRole('heading')).toHaveTextContent('betterAuth.verifyEmail.expired.title');
    expect(screen.queryByText('betterAuth.verifyEmail.success.title')).not.toBeInTheDocument();
  });

  it('does not treat an untrusted success query as proof of verification', () => {
    mocks.search = 'status=success&callbackUrl=%2Flobehub%2F';

    render(<VerifyEmailPage />);

    expect(screen.queryByText('betterAuth.verifyEmail.success.title')).not.toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('betterAuth.verifyEmail.error.title');
  });

  it('does not trust an already-verified error query without a verified session', () => {
    mocks.search = 'error=EMAIL_ALREADY_VERIFIED&callbackUrl=%2Flobehub%2F';

    render(<VerifyEmailPage />);

    expect(
      screen.queryByText('betterAuth.verifyEmail.alreadyVerified.title'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('betterAuth.verifyEmail.error.title');
  });

  it('keeps the completed state for a genuinely verified session', () => {
    mocks.search = 'error=EMAIL_ALREADY_VERIFIED&callbackUrl=%2Flobehub%2Fonboarding';
    mocks.session = { user: { emailVerified: true } };

    render(<VerifyEmailPage />);

    expect(screen.getByRole('heading')).toHaveTextContent(
      'betterAuth.verifyEmail.alreadyVerified.title',
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', '/lobehub/onboarding');
  });

  it('shows a generic failure state for unknown codes without exposing the code', () => {
    mocks.search = 'error=DATABASE_HOST_FAILURE&callbackUrl=%2Flobehub%2F';

    render(<VerifyEmailPage />);

    expect(screen.getByRole('heading')).toHaveTextContent('betterAuth.verifyEmail.error.title');
    expect(screen.getByText('betterAuth.verifyEmail.error.description')).toBeInTheDocument();
    expect(screen.queryByText('DATABASE_HOST_FAILURE')).not.toBeInTheDocument();
  });

  it('shows a recoverable error instead of a fake at-sign address when email is missing', () => {
    render(<VerifyEmailPage />);

    expect(screen.getByRole('heading')).toHaveTextContent('betterAuth.verifyEmail.error.title');
    expect(screen.getByText('betterAuth.verifyEmail.error.description')).toBeInTheDocument();
    expect(screen.queryByText('resend-control')).not.toBeInTheDocument();
  });
});
