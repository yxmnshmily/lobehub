import * as BaseUI from '@lobehub/ui/base-ui';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Form } from 'antd';
import { type ReactElement, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignInEmailStep } from '@/features/Auth/SignIn/SignInEmailStep';

import AuthAgreement, { useAuthAgreement } from './AuthAgreement';
import AuthFooterLinks from './AuthFooterLinks';

interface TransMockProps {
  components?: Record<string, ReactElement>;
  i18nKey: string;
}

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  Trans: ({ components, i18nKey }: TransMockProps) => (
    <>
      {i18nKey}
      {components?.terms}
      {components?.privacy}
    </>
  ),
}));

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const expectLinksToOpenInNewTabs = () => {
  const links = screen.getAllByRole('link');

  expect(links).toHaveLength(2);
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/terms.html',
    '/privacy-policy.html',
  ]);
  for (const link of links) {
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  }
};

describe('AuthAgreement', () => {
  it('should keep the passive agreement visible and open its links in new tabs', () => {
    render(<AuthAgreement />);

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('footer.agreement')).toBeTruthy();
    expectLinksToOpenInNewTabs();
  });

  it('should use the active agreement copy with the checkbox', () => {
    render(<AuthAgreement checked={false} onChange={vi.fn()} />);

    expect(
      screen.getByRole('checkbox', {
        name: /agreement\.confirm\.title|确认服务条款|Terms and Privacy Policy/,
      }),
    ).toBeTruthy();
    expect(screen.getByText('agreement.checkbox')).toBeTruthy();
    expectLinksToOpenInNewTabs();
  });
});

describe('SignInEmailStep', () => {
  const ModeSwitcher = () => {
    const [form] = Form.useForm<{ email: string }>();
    const [authMode, setAuthMode] = useState<'email' | 'phone'>('phone');

    return (
      <SignInEmailStep
        enablePhoneAuth
        serverConfigInit
        authMode={authMode}
        form={form}
        isSocialOnly={false}
        loading={false}
        oAuthSSOProviders={[]}
        setAuthMode={setAuthMode}
        socialLoading={null}
        onCheckUser={vi.fn(async () => {})}
        onGoToSignup={vi.fn()}
        onResetEmail={vi.fn()}
        onSetPassword={vi.fn()}
        onSocialSignIn={vi.fn()}
      />
    );
  };

  it('should show phone and mail icons in the auth mode buttons', () => {
    render(<ModeSwitcher />);

    expect(
      screen.getByRole('button', { name: /phoneTab|手机号登录/ }).querySelector('.lucide-phone'),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /emailTab|邮箱登录/ }).querySelector('.lucide-mail'),
    ).toBeTruthy();
  });

  it('should keep the phone and email input wrappers at the same control height', () => {
    const { container } = render(<ModeSwitcher />);
    const phoneInput = container.querySelector('input[inputmode="tel"]');
    const phoneWrapper = phoneInput?.closest<HTMLElement>('.ant-input-affix-wrapper');
    expect(phoneWrapper?.style.padding).toBe('6px');

    fireEvent.click(screen.getByRole('button', { name: /emailTab|邮箱登录/ }));
    const emailInput = container.querySelector('input[inputmode="email"]');
    const emailWrapper = emailInput?.closest<HTMLElement>('.ant-input-affix-wrapper');
    expect(emailWrapper?.style.padding).toBe('6px');
  });

  it('should reserve the email footer height while phone sign-in is active', () => {
    const { container } = render(<ModeSwitcher />);
    const reservedFooter = [
      ...container.querySelectorAll<HTMLElement>('[aria-hidden="true"]'),
    ].find((element) => /noAccount|还没有账号/.test(element.textContent || ''));

    expect(reservedFooter).toBeTruthy();
  });

  it('should continue social sign-in without confirmation when agreement is checked by default', () => {
    vi.spyOn(BaseUI, 'confirmModal');
    const onSocialSignIn = vi.fn();

    const TestSignInEmailStep = () => {
      const [form] = Form.useForm<{ email: string }>();

      return (
        <SignInEmailStep
          disableEmailPassword
          serverConfigInit
          form={form}
          isSocialOnly={false}
          loading={false}
          oAuthSSOProviders={['google']}
          socialLoading={null}
          onCheckUser={vi.fn(async () => {})}
          onGoToSignup={vi.fn()}
          onResetEmail={vi.fn()}
          onSetPassword={vi.fn()}
          onSocialSignIn={onSocialSignIn}
        />
      );
    };

    render(<TestSignInEmailStep />);
    fireEvent.click(screen.getByRole('button', { name: /Google/ }));

    expect(BaseUI.confirmModal).not.toHaveBeenCalled();
    expect(onSocialSignIn).toHaveBeenCalledWith('google');
  });
});

describe('AuthFooterLinks', () => {
  it('should open its links in new tabs', () => {
    render(<AuthFooterLinks />);

    expectLinksToOpenInNewTabs();
  });
});

describe('useAuthAgreement', () => {
  it('should keep the agreement unchecked when confirmation is cancelled', () => {
    const requestConfirmation = vi.fn();
    const continueAction = vi.fn();
    const { result } = renderHook(() => useAuthAgreement(requestConfirmation));

    act(() => {
      result.current.continueWithAgreement(continueAction);
    });

    expect(result.current.agreementChecked).toBe(false);
    expect(requestConfirmation).toHaveBeenCalledOnce();
    expect(continueAction).not.toHaveBeenCalled();
  });

  it('should check the agreement and reuse consent after confirmation', () => {
    const requestConfirmation = vi.fn((onConfirm: () => void) => onConfirm());
    const continueAction = vi.fn();
    const { result } = renderHook(() => useAuthAgreement(requestConfirmation));

    act(() => {
      result.current.continueWithAgreement(continueAction);
    });

    expect(result.current.agreementChecked).toBe(true);

    act(() => {
      result.current.continueWithAgreement(continueAction);
    });

    expect(requestConfirmation).toHaveBeenCalledOnce();
    expect(continueAction).toHaveBeenCalledTimes(2);
  });

  it('should skip confirmation when the agreement is checked manually', () => {
    const requestConfirmation = vi.fn();
    const continueAction = vi.fn();
    const { result } = renderHook(() => useAuthAgreement(requestConfirmation));

    act(() => {
      result.current.setAgreementChecked(true);
    });

    act(() => {
      result.current.continueWithAgreement(continueAction);
    });

    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(continueAction).toHaveBeenCalledOnce();
  });

  it('should skip confirmation on later visits after consent was given once', () => {
    const requestConfirmation = vi.fn((onConfirm: () => void) => onConfirm());
    const continueAction = vi.fn();
    const firstVisit = renderHook(() => useAuthAgreement(requestConfirmation));

    act(() => {
      firstVisit.result.current.continueWithAgreement(continueAction);
    });
    firstVisit.unmount();

    // A fresh hook instance simulates the user returning to the sign-in page.
    const secondVisit = renderHook(() => useAuthAgreement(requestConfirmation));

    expect(secondVisit.result.current.agreementChecked).toBe(true);

    act(() => {
      secondVisit.result.current.continueWithAgreement(continueAction);
    });

    expect(requestConfirmation).toHaveBeenCalledOnce();
    expect(continueAction).toHaveBeenCalledTimes(2);
  });

  it('should forget persisted consent once the agreement is unchecked', () => {
    const requestConfirmation = vi.fn();
    const firstVisit = renderHook(() => useAuthAgreement(requestConfirmation));

    act(() => {
      firstVisit.result.current.setAgreementChecked(true);
    });
    act(() => {
      firstVisit.result.current.setAgreementChecked(false);
    });
    firstVisit.unmount();

    const secondVisit = renderHook(() => useAuthAgreement(requestConfirmation));

    expect(secondVisit.result.current.agreementChecked).toBe(false);
  });
});
