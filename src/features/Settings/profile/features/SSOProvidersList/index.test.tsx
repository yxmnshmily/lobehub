import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SSOProvidersList from '.';

const state = vi.hoisted(() => ({
  authProviders: [{ provider: 'google', providerAccountId: 'google-1' }],
  authProvidersError: false,
  hasPasswordAccount: false,
  isLoadedAuthProviders: true,
  isLoadingAuthProviders: false,
  isSignedIn: true,
  refreshAuthProviders: vi.fn(),
}));
vi.mock('@/store/user', () => ({ useUserStore: (selector: any) => selector(state) }));
vi.mock('@/store/serverConfig', () => ({ useServerConfigStore: (selector: any) => selector({}) }));
vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: { oAuthSSOProviders: () => ['google'] },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  state.authProviders = [{ provider: 'google', providerAccountId: 'google-1' }];
  state.authProvidersError = false;
  state.isLoadedAuthProviders = true;
  state.refreshAuthProviders.mockClear();
});

describe('connected account display', () => {
  it('shows the confirmed Google link without optional email metadata', () => {
    render(<SSOProvidersList />);
    expect(screen.getByText('google')).toBeVisible();
    expect(screen.queryByText('profile.sso.link.button')).not.toBeInTheDocument();
  });
  it('shows retry instead of pretending a failed request means no linked accounts', () => {
    state.authProviders = [];
    state.authProvidersError = true;
    state.isLoadedAuthProviders = false;
    render(<SSOProvidersList />);
    expect(screen.getByRole('alert')).toHaveTextContent('profile.sso.loadError');
    fireEvent.click(screen.getByText('profile.sso.retry'));
    expect(state.refreshAuthProviders).toHaveBeenCalledOnce();
    expect(screen.queryByText('profile.sso.link.button')).not.toBeInTheDocument();
  });
  it('keeps a confirmed link visible during a failed refresh', () => {
    state.authProvidersError = true;
    state.isLoadedAuthProviders = false;
    render(<SSOProvidersList />);
    expect(screen.getByText('google')).toBeVisible();
    expect(screen.getByText('profile.sso.retry')).toBeVisible();
  });
});
