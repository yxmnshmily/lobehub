/** @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import SharePopover from '.';

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  update: vi.fn(),
  copy: vi.fn(),
  confirm: vi.fn(),
  mutate: vi.fn(),
  info: undefined as any,
  allowed: true,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({
  copyToClipboard: mocks.copy,
  usePopoverContext: () => ({ close: vi.fn() }),
  Flexbox: ({ children }: any) => <div>{children}</div>,
  Popover: ({ content }: any) => content,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Text: ({ children }: any) => <span>{children}</span>,
  Checkbox: () => null,
  confirmModal: mocks.confirm,
  Select: ({ value, onChange, options }: any) => (
    <select aria-label="visibility" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option disabled={o.disabled} key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('antd', () => ({ Divider: () => <hr /> }));
vi.mock('@/components/Skeleton', () => ({ ArticleSkeleton: () => <p>loading</p> }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'http://localhost:3010' }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/hooks/useTopicSharePermission', () => ({
  useTopicSharePermission: () => ({ allowed: mocks.allowed }),
}));
vi.mock('@/store/chat', () => ({ useChatStore: (select: any) => select({ activeTopicId: 't1' }) }));
vi.mock('@/store/global', () => ({ useGlobalStore: () => [false, vi.fn()] }));
vi.mock('swr', () => ({
  default: () => ({ data: mocks.info, isLoading: false, mutate: mocks.mutate }),
}));
vi.mock('@/services/topic', () => ({
  topicService: {
    enableSharing: mocks.publish,
    updateShareVisibility: mocks.update,
    getShareInfo: vi.fn(),
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.info = undefined;
  mocks.allowed = true;
  mocks.publish.mockResolvedValue({ id: 's1', visibility: 'link' });
  mocks.mutate.mockResolvedValue({ id: 's1', visibility: 'link' });
});
it('preselects link without publishing, then confirms before creating and copying', async () => {
  render(<SharePopover confirmOnCopy open topicId="t1" />);
  expect(screen.getByRole('combobox')).toHaveValue('link');
  expect(mocks.publish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'shareModal.copyLink' }));
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(mocks.copy).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  await mocks.confirm.mock.lastCall![0].onOk();
  expect(mocks.publish).toHaveBeenCalledWith('t1', 'link');
  await waitFor(() =>
    expect(mocks.copy).toHaveBeenCalledWith(expect.stringContaining('/share/t/s1')),
  );
});
it('keeps private revocation immediate and does not publish on choosing link', async () => {
  mocks.info = { id: 's1', visibility: 'link' };
  render(<SharePopover confirmOnCopy open topicId="t1" />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'private' } });
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('t1', 'private'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'link' } });
  expect(mocks.update).toHaveBeenCalledTimes(1);
  expect(mocks.copy).not.toHaveBeenCalled();
});
it('does not offer publishing to a restricted member', () => {
  mocks.allowed = false;
  render(<SharePopover confirmOnCopy open topicId="t1" />);
  expect(screen.getByRole('combobox')).toHaveValue('private');
  expect(screen.queryByRole('button', { name: 'shareModal.copyLink' })).toBeNull();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it('keeps an already-public link copyable without granting publishing permission', async () => {
  mocks.allowed = false;
  mocks.info = { id: 's1', visibility: 'link' };
  render(<SharePopover confirmOnCopy open topicId="t1" />);
  fireEvent.click(screen.getByRole('button', { name: 'shareModal.copyLink' }));
  await mocks.confirm.mock.lastCall![0].onOk();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.copy).toHaveBeenCalledWith(expect.stringContaining('/share/t/s1'));
});
it('retains the visible public state if making it private fails', async () => {
  mocks.info = { id: 's1', visibility: 'link' };
  mocks.update.mockRejectedValueOnce(new Error('network failure'));
  render(<SharePopover confirmOnCopy open topicId="t1" />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'private' } });
  await waitFor(() => expect(mocks.update).toHaveBeenCalled());
  expect(screen.getByRole('combobox')).toHaveValue('link');
});
