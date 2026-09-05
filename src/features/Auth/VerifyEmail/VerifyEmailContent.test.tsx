import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyEmailContent } from './VerifyEmailContent';

const mocks = vi.hoisted(() => ({
  handleRequestOtp: vi.fn(),
  handleResendEmail: vi.fn(),
  handleVerifyOtp: vi.fn(),
  setMode: vi.fn(),
  state: {
    emailResendSeconds: 0,
    mode: 'otp' as 'link' | 'otp',
    otpResendSeconds: 42,
    requestingOtp: false,
    resending: false,
    verifyingOtp: false,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { seconds?: number }) => `${key}${values?.seconds ?? ''}`,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} onClick={onClick}>
      {children}
    </button>
  ),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('./useVerifyEmail', () => ({
  useVerifyEmail: () => ({
    ...mocks.state,
    handleRequestOtp: mocks.handleRequestOtp,
    handleResendEmail: mocks.handleResendEmail,
    handleVerifyOtp: mocks.handleVerifyOtp,
    setMode: mocks.setMode,
  }),
}));

describe('VerifyEmailContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.mode = 'otp';
    mocks.state.emailResendSeconds = 0;
    mocks.state.otpResendSeconds = 42;
  });

  it('renders an accessible six-digit one-time-code input and submits its digits', () => {
    render(<VerifyEmailContent callbackUrl="/lobehub/" email="123456789@qq.com" />);

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('maxlength', '6');

    fireEvent.change(input, { target: { value: '12a34567' } });
    fireEvent.click(screen.getByRole('button', { name: 'betterAuth.verifyEmail.otp.submit' }));

    expect(mocks.handleVerifyOtp).toHaveBeenCalledWith('123456');
  });

  it('shows the resend countdown while keeping a route back to link verification', () => {
    render(<VerifyEmailContent callbackUrl="/lobehub/" email="member@example.test" />);

    expect(
      screen.getByRole('button', { name: 'betterAuth.verifyEmail.otp.resend42' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'betterAuth.verifyEmail.otp.useLink' }));
    expect(mocks.setMode).toHaveBeenCalledWith('link');
  });

  it('disables link resend while its cooldown is active', () => {
    mocks.state.mode = 'link';
    mocks.state.emailResendSeconds = 60;
    render(<VerifyEmailContent callbackUrl="/lobehub/" email="member@example.test" />);

    expect(
      screen.getByRole('button', { name: 'betterAuth.verifyEmail.resend.button' }),
    ).toBeDisabled();
  });

  it('clears an OTP entered for a previous mailbox when the account changes', () => {
    const { rerender } = render(
      <VerifyEmailContent callbackUrl="/lobehub/" email="account-a@example.test" />,
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '123456' } });
    expect(input).toHaveValue('123456');

    rerender(<VerifyEmailContent callbackUrl="/lobehub/" email="account-b@example.test" />);

    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
