import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProfileSetting from '.';

const fetchAuthProviders = vi.fn();
const useFetchUserComposioConnections = vi.fn();

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: any) => unknown) =>
    selector({ serverConfig: { disableEmailPassword: false, enableComposio: true } }),
}));

vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: {
    disableEmailPassword: (state: any) => state.serverConfig.disableEmailPassword,
    enableComposio: (state: any) => state.serverConfig.enableComposio,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: any) => unknown) =>
    selector({
      fetchAuthProviders,
      isLoaded: true,
      isLoadedAuthProviders: true,
      isSignedIn: true,
      user: { email: 'customer@example.com' },
    }),
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    isLoadedAuthProviders: (state: any) => state.isLoadedAuthProviders,
    isLogin: (state: any) => state.isSignedIn,
  },
  userProfileSelectors: {
    userProfile: (state: any) => state.user,
  },
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: any) => unknown) =>
    selector({
      composioServers: [{ identifier: 'gmail', status: 'ACTIVE' }],
      isComposioServersInit: true,
      useFetchUserComposioConnections,
    }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./features/AvatarRow', () => ({ default: () => <div>avatar-row</div> }));
vi.mock('./features/EmailRow', () => ({ default: () => <div>email-row</div> }));
vi.mock('./features/FullNameRow', () => ({ default: () => <div>name-row</div> }));
vi.mock('./features/InterestsRow', () => ({ default: () => <div>interests-row</div> }));
vi.mock('./features/PasswordRow', () => ({ default: () => <div>password-row</div> }));
vi.mock('./features/ProfileRow', () => ({
  default: ({ children, label }: { children: React.ReactNode; label: string }) => (
    <div>
      {label}
      {children}
    </div>
  ),
}));
vi.mock('./features/SSOProvidersList', () => ({ default: () => <div>sso-list</div> }));
vi.mock('./features/UsernameRow', () => ({ default: () => <div>username-row</div> }));

describe('customer profile settings', () => {
  beforeEach(() => {
    fetchAuthProviders.mockClear();
    useFetchUserComposioConnections.mockClear();
  });

  it('does not fetch or render Composio authorization management', () => {
    render(<ProfileSetting showSettingHeader={false} />);

    expect(useFetchUserComposioConnections).not.toHaveBeenCalled();
    expect(screen.queryByText('profile.authorizations.title')).not.toBeInTheDocument();
  });
});
