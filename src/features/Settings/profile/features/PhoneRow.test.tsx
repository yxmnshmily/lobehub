import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PhoneRow from './PhoneRow';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  verify: vi.fn(),
  refresh: vi.fn(),
  session: { user: { phoneNumber: '' } },
}));
vi.mock('@/libs/better-auth/auth-client', () => ({
  phoneNumber: { sendOtp: mocks.send, verify: mocks.verify },
  useSession: () => ({ data: mocks.session, refetch: mocks.refresh }),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector({ refreshUserState: mocks.refresh }),
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: any) => selector({ serverConfig: { enablePhoneAuth: true } }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./ProfileRow', () => ({
  default: ({ children, action, labelSlot }: any) => (
    <div>
      {labelSlot}
      {children}
      {action}
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.user.phoneNumber = '';
  mocks.send.mockResolvedValue({ data: { status: true } });
  mocks.verify.mockResolvedValue({ data: { status: true } });
  mocks.refresh.mockResolvedValue(undefined);
});

const open = () => {
  render(<PhoneRow />);
  fireEvent.click(screen.getByText('profile.bindPhone'));
};
const send = async () => {
  fireEvent.change(screen.getByLabelText('profile.phone'), { target: { value: '13800138000' } });
  fireEvent.click(screen.getByText('betterAuth.phone.sendCode'));
  await screen.findByLabelText('betterAuth.phone.codePlaceholder');
};

describe('phone binding', () => {
  it('marks the phone as required and prompts unbound users to complete it', () => {
    render(<PhoneRow />);
    expect(screen.getByText('*')).toBeVisible();
    expect(screen.getByText('profile.phoneRequired')).toBeVisible();
    fireEvent.click(screen.getByText('profile.bindPhone'));
    expect(screen.getByLabelText('profile.phone')).toBeRequired();
    fireEvent.click(screen.getByText('betterAuth.phone.sendCode'));
    expect(screen.getByText('betterAuth.phone.phoneInvalid')).toBeVisible();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('prevents repeat SMS requests during the cooldown', async () => {
    open();
    await send();
    const resend = screen.getByText('betterAuth.phone.resendIn');
    expect(resend.closest('button')).toBeDisabled();
    fireEvent.click(resend);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('keeps the input available after SMS delivery fails', async () => {
    mocks.send.mockResolvedValue({ error: { message: 'private provider error' } });
    open();
    fireEvent.change(screen.getByLabelText('profile.phone'), { target: { value: '13800138000' } });
    fireEvent.click(screen.getByText('betterAuth.phone.sendCode'));
    expect(await screen.findByText('betterAuth.phone.sendFailed')).toBeVisible();
    expect(screen.queryByText('profile.confirmPhone')).not.toBeInTheDocument();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('does not submit an invalid verification code', async () => {
    open();
    await send();
    fireEvent.click(screen.getByText('profile.confirmPhone'));
    expect(await screen.findByText('betterAuth.phone.codeInvalid')).toBeVisible();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('shows the existing bound number', () => {
    mocks.session.user.phoneNumber = '+8613800138000';
    render(<PhoneRow />);
    expect(screen.getByText('13800138000')).toBeVisible();
    expect(screen.getByText('profile.changePhone')).toBeVisible();
    expect(screen.queryByText('profile.bindPhone')).not.toBeInTheDocument();
  });
  it('uses registration OTP with explicit current-account binding and refreshes the profile', async () => {
    open();
    await send();
    expect(mocks.send).toHaveBeenCalledWith({ phoneNumber: '+8613800138000' });
    fireEvent.change(screen.getByLabelText('betterAuth.phone.codePlaceholder'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByText('profile.confirmPhone'));
    await waitFor(() =>
      expect(mocks.verify).toHaveBeenCalledWith({
        code: '123456',
        phoneNumber: '+8613800138000',
        updatePhoneNumber: true,
        disableSession: true,
      }),
    );
    expect(await screen.findByText('13800138000')).toBeVisible();
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it('rejects invalid numbers before requesting an SMS', async () => {
    open();
    fireEvent.change(screen.getByLabelText('profile.phone'), { target: { value: '123' } });
    fireEvent.click(screen.getByText('betterAuth.phone.sendCode'));
    expect(await screen.findByText('betterAuth.phone.phoneInvalid')).toBeVisible();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('opens the existing verification flow to change a bound number', async () => {
    mocks.session.user.phoneNumber = '+8613900139000';
    render(<PhoneRow />);
    fireEvent.click(screen.getByText('profile.changePhone'));
    await send();
    fireEvent.change(screen.getByLabelText('betterAuth.phone.codePlaceholder'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByText('profile.confirmPhone'));
    expect(await screen.findByText('13800138000')).toBeVisible();
    expect(mocks.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: '+8613800138000',
        updatePhoneNumber: true,
        disableSession: true,
      }),
    );
  });
  it('does not bind a changed number with a previous verification code', async () => {
    open();
    await send();
    fireEvent.change(screen.getByLabelText('profile.phone'), { target: { value: '13900139000' } });
    expect(screen.queryByText('profile.confirmPhone')).not.toBeInTheDocument();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('keeps failed verification editable without leaking backend error details', async () => {
    mocks.verify.mockResolvedValue({
      error: { code: 'PHONE_NUMBER_EXIST', message: 'private details' },
    });
    open();
    await send();
    fireEvent.change(screen.getByLabelText('betterAuth.phone.codePlaceholder'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByText('profile.confirmPhone'));
    expect(await screen.findByText('profile.phoneInUse')).toBeVisible();
    expect(screen.queryByText('private details')).not.toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
