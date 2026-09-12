/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProfileSetupModal from './ProfileSetupModal';

const mocks = vi.hoisted(() => ({
  fetchProfile: vi.fn(),
  mutateProfile: vi.fn(),
  socialConnect: undefined as unknown as { fetchProfile: ReturnType<typeof vi.fn>; profile: null },
  uploadWithProgress: vi.fn(),
}));
mocks.socialConnect = { fetchProfile: mocks.fetchProfile, profile: null };

vi.mock('@lobehub/ui', () => ({
  Center: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  Input: ({ prefix: _prefix, showCount: _showCount, value, ...props }: any) => (
    <input {...props} value={value ?? ''} />
  ),
  TextArea: ({ showCount: _showCount, value, ...props }: any) => (
    <textarea {...props} value={value ?? ''} />
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  confirmModal: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/components/EmojiPicker', () => ({
  default: ({ loading, onUpload, value }: any) => (
    <div>
      <span data-testid="avatar-value">{value}</span>
      <span data-testid="avatar-loading">{String(Boolean(loading))}</span>
      <button
        type="button"
        onClick={() => onUpload(new File(['avatar'], 'avatar.webp', { type: 'image/webp' }))}
      >
        upload-avatar
      </button>
    </div>
  ),
}));
vi.mock('@/components/ImperativeModal', () => ({
  default: ({ children, okButtonProps, onOk }: any) => (
    <div>
      {children}
      <button disabled={okButtonProps?.disabled} type="button" onClick={onOk}>
        save-profile
      </button>
    </div>
  ),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    market: {
      socialProfile: { scanClaimableResources: { query: vi.fn() } },
      user: { updateUserProfile: { mutate: mocks.mutateProfile } },
    },
  },
}));
vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: any) => unknown) =>
    selector({ uploadWithProgress: mocks.uploadWithProgress }),
}));
vi.mock('@/store/global', () => ({ useGlobalStore: () => 'zh-CN' }));
vi.mock('@/store/serverConfig', () => ({ useServerConfigStore: () => true }));
vi.mock('@/store/user', () => ({ useUserStore: () => 'https://example.com/old.png' }));
vi.mock('./SocialConnectButton', () => ({ default: () => null }));
vi.mock('./useSocialConnect', () => ({
  default: () => mocks.socialConnect,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const profile = {
  avatarUrl: 'https://example.com/old.png',
  bannerUrl: null,
  createdAt: '2026-09-08T00:00:00.000Z',
  description: null,
  displayName: '刘金旺',
  id: 1,
  namespace: 'yxmnshmily_gHYh2gpb',
  socialLinks: null,
  type: null,
  userName: 'yxmnshmily_gHYh2gpb',
};

const renderModal = () =>
  render(
    <ProfileSetupModal
      open
      accessToken="token"
      userProfile={profile}
      onClose={vi.fn()}
      onSuccess={vi.fn()}
    />,
  );

describe('ProfileSetupModal avatar upload', () => {
  beforeEach(() => {
    mocks.fetchProfile.mockReset().mockReturnValue(new Promise(() => {}));
    mocks.mutateProfile.mockReset();
    mocks.uploadWithProgress.mockReset();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:avatar-preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('shows the selected avatar immediately while its upload is pending', async () => {
    mocks.uploadWithProgress.mockReturnValue(new Promise(() => {}));
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'upload-avatar' }));

    expect(screen.getByTestId('avatar-value')).toHaveTextContent('blob:avatar-preview');
    expect(screen.getByTestId('avatar-loading')).toHaveTextContent('true');
  });

  it('does not save the stale avatar while its upload is pending', async () => {
    mocks.uploadWithProgress.mockReturnValue(new Promise(() => {}));
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'upload-avatar' }));
    fireEvent.click(screen.getByRole('button', { name: 'save-profile' }));

    expect(screen.getByRole('button', { name: 'save-profile' })).toBeDisabled();
    expect(mocks.mutateProfile).not.toHaveBeenCalled();
  });

  it('saves the uploaded URL after replacing the local preview', async () => {
    let resolveUpload!: (value: { url: string }) => void;
    mocks.uploadWithProgress.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );
    mocks.mutateProfile.mockResolvedValue({ user: { ...profile } });
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'upload-avatar' }));
    await act(async () => resolveUpload({ url: '/files/avatar.webp' }));
    await waitFor(() =>
      expect(screen.getByTestId('avatar-value')).toHaveTextContent('/files/avatar.webp'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'save-profile' }));

    await waitFor(() =>
      expect(mocks.mutateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ avatarUrl: '/files/avatar.webp' }),
      ),
    );
  });
});
