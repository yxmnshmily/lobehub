import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import InvitationPage from './InvitationPage';

const state = vi.hoisted(() => ({
  signedIn: false,
  join: vi.fn(),
  invalidate: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router', async (original) => ({
  ...(await original<any>()),
  useNavigate: () => state.navigate,
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector({ isSignedIn: state.signedIn }),
}));
vi.mock('@lobehub/ui', () => ({ Flexbox: ({ children }: any) => <div>{children}</div> }));
vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ title }: any) => <p>{title}</p>,
  Skeleton: () => null,
  Button: ({ href, children, onClick, disabled }: any) =>
    href ? (
      <a href={href}>{children}</a>
    ) : (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    useUtils: () => ({ groupConversation: { listGroups: { invalidate: state.invalidate } } }),
    groupMembership: {
      previewInvitationLink: { useQuery: () => ({ data: { title: '旅行群' }, isLoading: false }) },
      joinInvitationLink: { useMutation: () => ({ mutateAsync: state.join, isPending: false }) },
    },
  },
}));
const token = 'a'.repeat(43);
const mount = () =>
  render(
    <MemoryRouter initialEntries={[`/group-invite?token=${token}`]}>
      <InvitationPage />
    </MemoryRouter>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  state.signedIn = false;
  state.join.mockResolvedValue({ groupId: 'joined-group' });
  window.history.replaceState(null, '', `/lobehub/group-invite?token=${token}`);
});
it('preserves the invitation through both sign-in and registration without auto-joining', () => {
  mount();
  for (const [label, path] of [
    ['signin', 'signin'],
    ['signup', 'signup'],
  ]) {
    const target = new URL(
      screen.getByRole('link', { name: `groupInvitation.${label}` }).getAttribute('href')!,
      window.location.origin,
    );
    expect(target.pathname).toBe(`/lobehub/${path}`);
    expect(target.searchParams.get('callbackUrl')).toBe(`/lobehub/group-invite?token=${token}`);
  }
  expect(state.join).not.toHaveBeenCalled();
});
it('joins only after explicit confirmation and refreshes the joined-group list', async () => {
  state.signedIn = true;
  mount();
  expect(state.join).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'groupInvitation.join' }));
  await waitFor(() =>
    expect(state.navigate).toHaveBeenCalledWith('/group/joined-group', { replace: true }),
  );
  expect(state.join).toHaveBeenCalledWith({ token });
  expect(state.invalidate).toHaveBeenCalled();
});
