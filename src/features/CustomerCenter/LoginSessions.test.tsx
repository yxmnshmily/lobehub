import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LoginSessions from './LoginSessions';

const mocks = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@lobehub/ui/base-ui')),
  confirmModal: mocks.confirmModal,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    userSessionManagement: {
      listSessions: { query: mocks.listSessions },
      revokeSession: { mutate: mocks.revokeSession },
    },
  },
}));

const currentSession = {
  browserName: 'Chrome',
  createdAt: new Date('2026-09-01T08:00:00.000Z'),
  current: true,
  deviceName: 'macOS',
  expiresAt: new Date('2026-10-01T08:00:00.000Z'),
  maskedIp: '192.0.*.*',
  sessionId: 'current-opaque-session-id',
  updatedAt: new Date('2026-09-04T08:00:00.000Z'),
};

const otherSession = {
  browserName: 'Safari',
  createdAt: new Date('2026-09-02T08:00:00.000Z'),
  current: false,
  deviceName: 'iPhone',
  expiresAt: new Date('2026-10-02T08:00:00.000Z'),
  maskedIp: '2001:db8:*',
  sessionId: 'other-opaque-session-id',
  updatedAt: new Date('2026-09-03T08:00:00.000Z'),
};

beforeEach(() => {
  mocks.listSessions.mockResolvedValue([currentSession, otherSession]);
  mocks.revokeSession.mockResolvedValue({ revoked: true });
  mocks.confirmModal.mockImplementation(({ onOk }) => {
    void onOk?.();
    return { close: vi.fn() };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LoginSessions', () => {
  it('shows only the current user safe session projection and never offers current-session revoke', async () => {
    mocks.listSessions.mockResolvedValue([
      {
        ...currentSession,
        fullIp: '192.0.2.25',
        token: 'MUST_NOT_RENDER_SESSION_TOKEN',
        userAgent: 'MUST_NOT_RENDER_RAW_USER_AGENT',
      },
      otherSession,
    ]);

    const { container } = render(<LoginSessions locale="zh-CN" />);

    expect(screen.getByText('正在读取登录设备')).toBeTruthy();
    expect(await screen.findByText('Chrome · macOS')).toBeTruthy();
    expect(screen.getByText('Safari · iPhone')).toBeTruthy();
    expect(screen.getByText('192.0.*.*')).toBeTruthy();
    expect(screen.getByText('2001:db8:*')).toBeTruthy();
    expect(screen.getByText('当前会话')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '退出此设备' })).toHaveLength(1);

    const rendered = container.textContent ?? '';
    expect(rendered).not.toContain('192.0.2.25');
    expect(rendered).not.toContain('MUST_NOT_RENDER_SESSION_TOKEN');
    expect(rendered).not.toContain('MUST_NOT_RENDER_RAW_USER_AGENT');
  });

  it('ends loading on failure and retries without exposing an internal error', async () => {
    mocks.listSessions.mockRejectedValueOnce(new Error('database secret leaked'));

    render(<LoginSessions locale="zh-CN" />);

    expect(await screen.findByText('登录设备暂时无法读取')).toBeTruthy();
    expect(screen.queryByText('database secret leaked')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('Chrome · macOS')).toBeTruthy();
    expect(mocks.listSessions).toHaveBeenCalledTimes(2);
  });

  it('confirms and revokes only the selected non-current session with a duplicate-submit lock', async () => {
    let finishRevocation: (() => void) | undefined;
    mocks.revokeSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRevocation = () => resolve({ revoked: true });
        }),
    );
    render(<LoginSessions locale="zh-CN" />);
    await screen.findByText('Safari · iPhone');

    fireEvent.click(screen.getByRole('button', { name: '退出此设备' }));

    expect(mocks.confirmModal).toHaveBeenCalledOnce();
    expect(mocks.confirmModal).toHaveBeenCalledWith(
      expect.objectContaining({ cancelText: '取消', title: false }),
    );
    await mocks.confirmModal.mock.calls[0][0].onOk();
    expect(mocks.revokeSession).toHaveBeenCalledOnce();
    finishRevocation?.();
    await waitFor(() =>
      expect(mocks.revokeSession).toHaveBeenCalledWith({
        sessionId: otherSession.sessionId,
      }),
    );
    await waitFor(() => expect(screen.queryByText('Safari · iPhone')).toBeNull());
    expect(screen.getByText('Chrome · macOS')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '退出此设备' })).toBeNull();
  });

  it('renders long device histories in manageable batches', async () => {
    mocks.listSessions.mockResolvedValue([
      currentSession,
      ...Array.from({ length: 14 }, (_, index) => ({
        ...otherSession,
        browserName: `Safari ${index + 1}`,
        sessionId: `other-session-${index + 1}`,
      })),
    ]);

    render(<LoginSessions locale="zh-CN" />);

    expect(await screen.findByText('Safari 1 · iPhone')).toBeTruthy();
    expect(screen.queryByText('Safari 10 · iPhone')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示更多设备（剩余 5）' }));
    expect(await screen.findByText('Safari 14 · iPhone')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /显示更多设备/ })).toBeNull();
  });
});
