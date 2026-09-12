import type { UIChatMessage } from '@lobechat/types';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadAction } from './download';

const mocks = vi.hoisted(() => ({ modal: vi.fn(), error: vi.fn() }));
vi.mock('@lobehub/ui', () => ({ Flexbox: ({ children }: any) => <div>{children}</div> }));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick, title }: any) => (
    <button title={title} onClick={onClick}>
      {children}
    </button>
  ),
  createModal: mocks.modal,
  toast: { error: mocks.error, info: vi.fn() },
}));

const build = (data: Partial<UIChatMessage>) =>
  renderHook(() =>
    downloadAction.useBuild({
      data: { id: 'm1', content: '', role: 'assistant', ...data } as UIChatMessage,
      id: 'm1',
      role: 'assistant',
    }),
  ).result.current!;

describe('message download action', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.modal.mockReset();
  });
  it('downloads cleaned text as TXT without opening a chooser', () => {
    const createUrl = vi.fn((_blob: Blob) => 'blob:test');
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('message-m1.txt');
      expect(this.href).toBe('blob:test');
    });
    build({ content: '正文' }).handleClick?.();
    expect(click).toHaveBeenCalledOnce();
    expect(createUrl.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(mocks.modal).not.toHaveBeenCalled();
  });
  it('offers individual files and sends file proxies through native downloads', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    build({
      content: '正文',
      imageList: [{ id: 'img', alt: '桂林.png', url: '/f/img' }],
    }).handleClick?.();
    render(mocks.modal.mock.calls[0][0].content);
    expect(screen.getByRole('button', { name: '下载文本（TXT）' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '1. 桂林.png' }));
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('/f/img?download=1'),
      '_blank',
      'noopener,noreferrer',
    );
  });
});
