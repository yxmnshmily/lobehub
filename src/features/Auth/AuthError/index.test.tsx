import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AuthErrorPage from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));
vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useSearchParams: () => [new URLSearchParams('error=token%3Dsecret-fixture')],
}));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Icon: () => null,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, href }: { children: React.ReactNode; href?: string }) =>
    href ? <a href={href}>{children}</a> : <button>{children}</button>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('@icons-pack/react-simple-icons', () => ({ SiDiscord: () => null }));
vi.mock('antd-style', () => ({ cssVar: { colorText: '', fontFamilyCode: '' } }));
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

describe('AuthErrorPage', () => {
  it('uses a safe fallback without exposing the raw query error', () => {
    render(<AuthErrorPage />);

    expect(screen.getByText('codes.UNKNOWN')).toBeInTheDocument();
    expect(screen.queryByText(/secret-fixture|ErrorCode/)).not.toBeInTheDocument();
  });

  it('renders one mounted sign-in link instead of nested interactive controls', () => {
    window.history.replaceState({}, '', '/lobehub/auth-error');

    render(<AuthErrorPage />);

    expect(screen.getByRole('link', { name: 'actions.retry' })).toHaveAttribute(
      'href',
      '/lobehub/signin',
    );
    expect(screen.queryByRole('button', { name: 'actions.retry' })).not.toBeInTheDocument();
  });
});
