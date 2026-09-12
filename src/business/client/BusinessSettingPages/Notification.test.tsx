import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Notification from './Notification';

const state = vi.hoisted(() => ({
  sub: undefined as string | undefined,
  error: false,
  saved: vi.fn(),
  navigate: vi.fn(),
  openInbox: vi.fn(),
}));
vi.mock('@/features/HomeSidebar/Header/components/InboxModal', () => ({
  openInboxModal: state.openInbox,
}));
vi.mock('react-router', () => ({
  useParams: () => ({ sub: state.sub }),
  useLocation: () => ({ pathname: '/settings/notification' }),
  useNavigate: () => state.navigate,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    useUtils: () => ({ notification: { getSettings: { setData: vi.fn() } } }),
    notification: {
      getSettings: {
        useQuery: () => ({
          isLoading: false,
          isError: state.error,
          refetch: vi.fn(),
          data: {
            settings: {
              inbox: { enabled: true },
              email: { enabled: false },
              sms: { enabled: false },
            },
            channels: {
              inbox: { available: true, reason: '' },
              email: { available: true, reason: '' },
              sms: { available: false, reason: '短信通知模板尚未配置' },
            },
            deliveries: [],
          },
        }),
      },
      updateSetting: { useMutation: () => ({ mutateAsync: state.saved, isPending: false }) },
    },
  },
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button disabled={props.disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Switch: ({ checked, onChange, ...props }: any) => (
    <input
      aria-label={props['aria-label']}
      checked={checked}
      disabled={props.disabled}
      role="switch"
      type="checkbox"
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
  Alert: ({ message }: any) => <div role="alert">{message}</div>,
  Skeleton: () => <div aria-label="加载通知设置" />,
  toast: { success: vi.fn(), error: vi.fn() },
}));
beforeEach(() => {
  state.sub = undefined;
  state.error = false;
  state.saved.mockReset().mockResolvedValue({});
  state.navigate.mockReset();
  state.openInbox.mockReset();
});
describe('notification preferences', () => {
  it('shows the three working channel entrypoints and navigates to their details', () => {
    render(<Notification />);
    fireEvent.click(screen.getByRole('button', { name: /邮件通知/ }));
    expect(state.navigate).toHaveBeenCalledWith('/settings/notification/email');
    expect(screen.getByText('短信通知模板尚未配置')).toBeDefined();
  });
  it('persists a scenario switch with its channel and type', () => {
    state.sub = 'inbox';
    render(<Notification />);
    fireEvent.click(screen.getByRole('switch', { name: '图片生成完成' }));
    expect(state.saved).toHaveBeenCalledWith({
      channel: 'inbox',
      type: 'image_generation_completed',
      enabled: false,
    });
  });
  it('does not claim SMS can be enabled before its template is configured', () => {
    state.sub = 'sms';
    render(<Notification />);
    expect(
      (screen.getByRole('switch', { name: '启用短信通知' }) as HTMLInputElement).disabled,
    ).toBe(true);
  });
  it('reports a load error instead of presenting stale switches as saved settings', () => {
    state.error = true;
    render(<Notification />);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

it.each([undefined, 'inbox', 'email', 'sms'])(
  'opens the shared notification inbox from settings (%s)',
  (sub) => {
    state.sub = sub;
    render(<Notification />);
    fireEvent.click(screen.getByRole('button', { name: '查看通知' }));
    expect(state.openInbox).toHaveBeenCalledOnce();
    expect(state.saved).not.toHaveBeenCalled();
  },
);
