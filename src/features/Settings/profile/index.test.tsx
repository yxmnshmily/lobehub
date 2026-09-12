import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProfileSetting from '.';
import type * as FullNameRowModule from './features/FullNameRow';

const fetchAuthProviders = vi.fn();
const useFetchUserComposioConnections = vi.fn();
const profileState = {
  authProviders: [] as { provider: string }[],
  user: {
    id: 'user_profile_test',
    email: 'customer@example.com',
    fullName: 'Traveler',
    username: '',
    phone: '',
  },
  updateFullName: vi.fn(),
  updateUsername: vi.fn(),
};
vi.mock('@/libs/better-auth/auth-client', () => ({
  useSession: () => ({ data: { user: { phoneNumber: profileState.user.phone } } }),
}));

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
      ...profileState,
    }),
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    isLoadedAuthProviders: (state: any) => state.isLoadedAuthProviders,
    isLogin: (state: any) => state.isSignedIn,
  },
  userProfileSelectors: {
    fullName: (state: any) => state.user.fullName,
    username: (state: any) => state.user.username,
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
vi.mock('./features/PhoneRow', () => ({ default: () => <div>phone-row</div> }));
vi.mock('./features/ProfileRow', () => ({
  default: ({ children, label, action }: any) => (
    <div>
      {label}
      {children}
      {action}
    </div>
  ),
}));
vi.mock('./features/SSOProvidersList', () => ({ default: () => <div>sso-list</div> }));
vi.mock('./features/UsernameRow', () => ({ default: () => <div>username-row</div> }));

describe('customer profile settings', () => {
  beforeEach(() => {
    fetchAuthProviders.mockClear();
    useFetchUserComposioConnections.mockClear();
    profileState.authProviders = [];
    profileState.user = {
      id: 'user_profile_test',
      email: 'customer@example.com',
      fullName: 'Traveler',
      username: '',
      phone: '',
    };
    profileState.updateFullName.mockReset().mockResolvedValue(undefined);
    profileState.updateUsername.mockReset().mockResolvedValue(undefined);
  });

  it('does not fetch or render Composio authorization management', () => {
    render(<ProfileSetting showSettingHeader={false} />);

    expect(useFetchUserComposioConnections).not.toHaveBeenCalled();
    expect(screen.queryByText('profile.authorizations.title')).not.toBeInTheDocument();
  });
  it('requires a nonblank nickname and saves only after explicit confirmation', async () => {
    const { default: FullNameRow } =
      await vi.importActual<typeof FullNameRowModule>('./features/FullNameRow');
    render(<FullNameRow />);
    fireEvent.click(screen.getByRole('button', { name: 'profile.edit' }));
    const input = screen.getByRole('textbox');
    expect(input).toBeRequired();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'profile.save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('profile.fullNameRequired');
    expect(profileState.updateFullName).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ' New name ' } });
    fireEvent.blur(input);
    expect(profileState.updateFullName).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'profile.save' }));
    await waitFor(() => expect(profileState.updateFullName).toHaveBeenCalledWith('New name'));
  });
  it('shows the system user ID read-only with a text copy button', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<ProfileSetting showSettingHeader={false} />);
    expect(screen.getByText('profile.userId')).toBeVisible();
    expect(screen.getByText('user_profile_test')).toBeVisible();
    expect(screen.queryByText('username-row')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(profileState.updateUsername).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('user_profile_test'));
    writeText.mockRestore();
  });
  it('prompts a WeChat account to complete nickname and phone, but not a complete account', () => {
    profileState.authProviders = [{ provider: 'wechat' }];
    const view = render(<ProfileSetting showSettingHeader={false} />);
    expect(screen.getByText('profile.wechatCompleteProfile')).toBeVisible();
    profileState.user.phone = '+8613800138000';
    view.rerender(<ProfileSetting showSettingHeader={false} />);
    expect(screen.queryByText('profile.wechatCompleteProfile')).not.toBeInTheDocument();
  });
});
