import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EmailRow from './EmailRow';

const mocks = vi.hoisted(() => ({ changeEmail: vi.fn(), success: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Input: ({
    onPressEnter: _onPressEnter,
    status: _status,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { onPressEnter?: () => void; status?: string }) => (
    <input {...props} />
  ),
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    block: _block,
    children,
    loading: _loading,
    size: _size,
    type: _type,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    block?: boolean;
    loading?: boolean;
    size?: string;
    type?: string;
  }) => <button {...props}>{children}</button>,
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>{children}</span>
  ),
  toast: { success: mocks.success },
}));
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  m: { div: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
}));
vi.mock('@/libs/better-auth/auth-client', () => ({ changeEmail: mocks.changeEmail }));
vi.mock('@/store/user', () => ({ useUserStore: () => 'old@example.test' }));
vi.mock('@/store/user/selectors', () => ({ userProfileSelectors: { email: vi.fn() } }));
vi.mock('./ProfileRow', () => ({
  default: ({ action, children }: React.PropsWithChildren<{ action: React.ReactNode }>) => (
    <section>
      {action}
      {children}
    </section>
  ),
}));

describe('EmailRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/lobehub/settings/profile');
  });

  it('does not expose backend details when changing an email fails', async () => {
    mocks.changeEmail.mockResolvedValue({
      data: null,
      error: { message: 'postgres://internal-host?token=secret-fixture', status: 500 },
    });

    render(<EmailRow />);
    fireEvent.click(screen.getByText('profile.updateEmail'));
    fireEvent.change(screen.getByPlaceholderText('profile.emailPlaceholder'), {
      target: { value: 'next@example.test' },
    });
    fireEvent.click(screen.getByText('profile.save'));

    await waitFor(() => {
      expect(screen.getByText('profile.emailChangeError')).toBeInTheDocument();
    });
    expect(screen.queryByText(/internal-host|secret-fixture/)).not.toBeInTheDocument();
  });
});
