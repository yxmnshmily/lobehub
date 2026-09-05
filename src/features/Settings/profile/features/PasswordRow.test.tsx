import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PasswordRow from './PasswordRow';

const mocks = vi.hoisted(() => ({
  hasPasswordAccount: true,
  requestReset: vi.fn(),
  submit: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: string) =>
    selector === 'hasPasswordAccount' ? mocks.hasPasswordAccount : { email: 'member@example.test' },
}));
vi.mock('@/store/user/selectors', () => ({
  authSelectors: { hasPasswordAccount: 'hasPasswordAccount' },
  userProfileSelectors: { userProfile: 'userProfile' },
}));
vi.mock('./usePasswordReset', () => ({
  usePasswordReset: () => ({ requestReset: mocks.requestReset, sending: false, sent: false }),
}));
vi.mock('./useChangePassword', () => ({
  useChangePassword: () => ({
    changing: false,
    clearError: vi.fn(),
    error: '',
    submit: mocks.submit,
  }),
}));
vi.mock('./ProfileRow', () => ({
  default: ({ action, children }: React.PropsWithChildren<{ action: React.ReactNode }>) => (
    <section>
      {action}
      {children}
    </section>
  ),
}));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  InputPassword: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    htmlType,
    loading: _loading,
    size: _size,
    type: _type,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    htmlType?: 'button' | 'reset' | 'submit';
    loading?: boolean;
    size?: string;
    type?: string;
  }) => (
    <button type={htmlType} {...props}>
      {children}
    </button>
  ),
  Modal: ({
    children,
    closeIcon,
    open,
    title,
  }: React.PropsWithChildren<{
    closeIcon?: React.ReactNode;
    open: boolean;
    title: string;
  }>) =>
    open ? (
      <section aria-label={title} role="dialog">
        <button>{closeIcon}</button>
        {children}
      </section>
    ) : null,
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>{children}</span>
  ),
}));

describe('PasswordRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPasswordAccount = true;
    mocks.submit.mockResolvedValue(true);
  });

  it('opens an authenticated password change dialog for password accounts', () => {
    render(<PasswordRow />);

    fireEvent.click(screen.getByRole('button', { name: 'profile.changePassword' }));

    expect(screen.getByRole('dialog', { name: 'profile.changePassword' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'close' })).toBeInTheDocument();
    expect(screen.getByLabelText('profile.currentPassword')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(mocks.requestReset).not.toHaveBeenCalled();
  });

  it('keeps the verified-email set-password flow for accounts without a password', () => {
    mocks.hasPasswordAccount = false;
    render(<PasswordRow />);

    fireEvent.click(screen.getByRole('button', { name: 'profile.setPassword' }));

    expect(mocks.requestReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
