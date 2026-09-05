import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { getTestInstance } from 'better-auth/test';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import SettingsContent from './SettingsContent';

const access = vi.hoisted(() => ({ isLoading: false, isPlatformAdmin: false }));
const navigate = vi.hoisted(() => vi.fn());
const adminDataRequest = vi.hoisted(() => vi.fn());

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    platformAccess: {
      isPlatformAdmin: {
        useQuery: () => ({ data: access.isPlatformAdmin, isLoading: access.isLoading }),
      },
    },
  },
}));

vi.mock('@/features/NavHeader', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
}));

vi.mock('@/features/Setting/SettingContainer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/features/SettingsSearch/anchor', () => ({ useSettingsAnchorScroll: vi.fn() }));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: { enableBusinessFeatures: vi.fn() },
  useServerConfigStore: () => true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../memory/features/ManageMemoryButton', () => ({ ManageMemoryButton: () => null }));

vi.mock('./componentMap', () => ({
  componentMap: {
    'apikey': () => {
      adminDataRequest('apikey');
      return <div>api-key-view</div>;
    },
    'billing': () => <div>billing-view</div>,
    'credential': () => {
      adminDataRequest('credential');
      return <div>credential-view</div>;
    },
    'credits': () => <div>credits-view</div>,
    'oauth-apps': () => {
      adminDataRequest('oauth-apps');
      return <div>oauth-apps-view</div>;
    },
    'labs': () => {
      adminDataRequest('labs');
      return <div>labs-view</div>;
    },
    'profile': () => <div>profile-view</div>,
    'provider': () => {
      adminDataRequest('provider');
      return <div>provider-view</div>;
    },
    'security': () => <div>security-view</div>,
    'service-model': () => {
      adminDataRequest('service-model');
      return <div>service-model-view</div>;
    },
    'service-operations': () => {
      adminDataRequest('service-operations');
      return <div>service-operations-view</div>;
    },
    'skill': () => {
      adminDataRequest('skill');
      return <div>skill-view</div>;
    },
    'storage': () => {
      adminDataRequest('storage');
      return <div>storage-view</div>;
    },
    'usage': () => <div>usage-view</div>,
  },
}));

afterEach(() => {
  cleanup();
  access.isLoading = false;
  access.isPlatformAdmin = false;
  navigate.mockReset();
  adminDataRequest.mockReset();
});

describe('SettingsContent customer route guard', () => {
  it('takes a newly verified account through session-safe password rotation into its personal center', async () => {
    const baseURL = 'https://customer-lifecycle.example.test';
    const account = {
      email: 'new-customer@example.test',
      name: 'New Customer',
      password: 'Test-only-customer-123!',
    };
    const nextPassword = 'Test-only-customer-456!';
    const resetDeliveries: string[] = [];
    let verificationUrl: string | undefined;
    const instance = await getTestInstance(
      {
        basePath: '/api/auth',
        baseURL,
        emailAndPassword: {
          enabled: true,
          requireEmailVerification: true,
          sendResetPassword: async ({ user }) => {
            resetDeliveries.push(user.email);
          },
        },
        emailVerification: {
          autoSignInAfterVerification: false,
          sendVerificationEmail: async ({ url }) => {
            verificationUrl = url;
          },
        },
        rateLimit: { enabled: false },
      },
      { disableTestUser: true },
    );
    const request = (pathname: string, body: unknown, authorization?: string) =>
      instance.auth.handler(
        new Request(`${baseURL}${pathname}`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
            'origin': baseURL,
            ...(authorization && { authorization }),
          },
          method: 'POST',
        }),
      );
    const signIn = async (password: string) => {
      const response = await request('/api/auth/sign-in/email', {
        callbackURL: '/lobehub/settings/profile',
        email: account.email,
        password,
      });
      const payload = response.status === 200 ? await response.clone().json() : null;
      return {
        authorization: payload?.token ? `Bearer ${payload.token}` : '',
        payload,
        response,
      };
    };

    const signUp = await instance.client.signUp.email({
      ...account,
      callbackURL: '/lobehub/settings/profile',
    });
    expect(signUp.error).toBeNull();
    expect((await signIn(account.password)).response.status).toBe(403);

    const verificationToken = verificationUrl
      ? new URL(verificationUrl).searchParams.get('token')
      : null;
    expect(verificationToken).toBeTruthy();
    expect(
      await instance.auth.api.verifyEmail({ query: { token: verificationToken! } }),
    ).toMatchObject({ status: true });

    const currentSession = await signIn(account.password);
    const otherSession = await signIn(account.password);
    expect(currentSession.response.status).toBe(200);
    expect(currentSession.response.headers.get('location')).toBe('/lobehub/settings/profile');
    expect(otherSession.response.status).toBe(200);

    const passwordChange = await request(
      '/api/auth/change-password',
      {
        currentPassword: account.password,
        newPassword: nextPassword,
        revokeOtherSessions: true,
      },
      currentSession.authorization,
    );
    expect(passwordChange.status).toBe(200);
    const passwordChangeBody = await passwordChange.json();
    expect(passwordChangeBody.token).toBeTruthy();
    const rotatedAuthorization = `Bearer ${passwordChangeBody.token}`;
    expect(
      await instance.auth.api.getSession({
        headers: new Headers({ authorization: currentSession.authorization }),
      }),
    ).toBeNull();
    expect(
      await instance.auth.api.getSession({
        headers: new Headers({ authorization: otherSession.authorization }),
      }),
    ).toBeNull();
    expect(
      (
        await instance.auth.api.getSession({
          headers: new Headers({ authorization: rotatedAuthorization }),
        })
      )?.user.email,
    ).toBe(account.email);
    expect((await signIn(account.password)).response.status).toBe(401);
    expect((await signIn(nextPassword)).response.status).toBe(200);

    const existingReset = await request('/api/auth/request-password-reset', {
      email: account.email,
      redirectTo: '/lobehub/reset-password',
    });
    const unknownReset = await request('/api/auth/request-password-reset', {
      email: 'unknown-customer@example.test',
      redirectTo: '/lobehub/reset-password',
    });
    expect(existingReset.status).toBe(200);
    expect(unknownReset.status).toBe(200);
    expect(await existingReset.json()).toEqual(await unknownReset.json());
    expect(resetDeliveries).toEqual([account.email]);

    render(<SettingsContent activeTab={SettingsTabs.Profile} />);

    expect(screen.getByText('profile-view')).toBeTruthy();
    expect(screen.queryByText('provider-view')).toBeNull();
    expect(adminDataRequest).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    [SettingsTabs.Provider, 'provider-view'],
    [SettingsTabs.ServiceModel, 'service-model-view'],
    [SettingsTabs.Skill, 'skill-view'],
    [SettingsTabs.Creds, 'credential-view'],
    [SettingsTabs.APIKey, 'api-key-view'],
    [SettingsTabs.OAuthApps, 'oauth-apps-view'],
    [SettingsTabs.Storage, 'storage-view'],
    [SettingsTabs.Labs, 'labs-view'],
    [SettingsTabs.ServiceOperations, 'service-operations-view'],
    [SettingsTabs.Plans, 'plans-view'],
    [SettingsTabs.Referral, 'referral-view'],
    [SettingsTabs.Connector, 'connector-view'],
    [SettingsTabs.Memory, 'memory-view'],
    [SettingsTabs.Appearance, 'appearance-view'],
    [SettingsTabs.Devices, 'devices-view'],
    [SettingsTabs.Hotkey, 'hotkey-view'],
    [SettingsTabs.Messenger, 'messenger-view'],
    [SettingsTabs.Notification, 'notification-view'],
    [SettingsTabs.Proxy, 'proxy-view'],
    [SettingsTabs.SystemTools, 'system-tools-view'],
    [SettingsTabs.Stats, 'stats-view'],
  ])('blocks an ordinary user from opening %s by direct URL', async (tab, label) => {
    render(<SettingsContent activeTab={tab} />);

    expect(screen.queryByText(label)).toBeNull();
    expect(adminDataRequest).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/settings/profile', {
        escape: true,
        replace: true,
      }),
    );
  });

  it.each([
    [SettingsTabs.Profile, 'profile-view'],
    [SettingsTabs.Security, 'security-view'],
    [SettingsTabs.Credits, 'credits-view'],
    [SettingsTabs.Billing, 'billing-view'],
    [SettingsTabs.Usage, 'usage-view'],
  ])('keeps the customer-owned %s page available after a fresh mount', (tab, label) => {
    const firstMount = render(<SettingsContent activeTab={tab} />);

    expect(screen.getByText(label)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();

    firstMount.unmount();
    render(<SettingsContent activeTab={tab} />);

    expect(screen.getByText(label)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    [SettingsTabs.Provider, 'provider-view'],
    [SettingsTabs.ServiceModel, 'service-model-view'],
    [SettingsTabs.Skill, 'skill-view'],
    [SettingsTabs.Creds, 'credential-view'],
    [SettingsTabs.APIKey, 'api-key-view'],
    [SettingsTabs.OAuthApps, 'oauth-apps-view'],
    [SettingsTabs.Storage, 'storage-view'],
    [SettingsTabs.Labs, 'labs-view'],
    [SettingsTabs.ServiceOperations, 'service-operations-view'],
  ])('does not flash %s before the role query settles', (tab, label) => {
    access.isLoading = true;
    access.isPlatformAdmin = true;

    render(<SettingsContent activeTab={tab} />);

    expect(screen.queryByText(label)).toBeNull();
    expect(adminDataRequest).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('applies the same direct URL guard to the mobile settings content', async () => {
    render(<SettingsContent mobile activeTab={SettingsTabs.Provider} />);

    expect(screen.queryByText('provider-view')).toBeNull();
    expect(adminDataRequest).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/settings/profile', {
        escape: true,
        replace: true,
      }),
    );
  });

  it('keeps restricted settings available to a platform administrator', () => {
    access.isPlatformAdmin = true;

    render(<SettingsContent activeTab={SettingsTabs.Provider} />);

    expect(screen.getByText('provider-view')).toBeTruthy();
    expect(adminDataRequest).toHaveBeenCalledWith('provider');
    expect(navigate).not.toHaveBeenCalled();
  });
});
