/** @vitest-environment happy-dom */
import { beforeEach, expect, it, vi } from 'vitest';

import { configureWechatShare } from './wechatShare';

let ready: () => void;
const wx = {
  config: vi.fn(),
  ready: (callback: () => void) => {
    ready = callback;
  },
  error: vi.fn(),
  updateAppMessageShareData: vi.fn((data) => data.success()),
  updateTimelineShareData: vi.fn((data) => data.success()),
};
const signature = { appId: 'app', nonceStr: 'nonce', timestamp: 1, signature: 'sig' };
const card = {
  title: 'Travel group',
  desc: 'Join us',
  link: 'https://example.com/lobehub/group-invite?token=abc',
  imgUrl: 'https://example.com/icon.png',
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(window, { wx });
});
it('configures both share menus with the invitation URL after SDK verification', async () => {
  const pending = configureWechatShare(signature, card, new AbortController().signal);
  await vi.waitFor(() => expect(wx.config).toHaveBeenCalled());
  expect(wx.updateAppMessageShareData).not.toHaveBeenCalled();
  ready();
  await pending;
  expect(wx.updateAppMessageShareData).toHaveBeenCalledWith(expect.objectContaining(card));
  expect(wx.updateTimelineShareData).toHaveBeenCalledWith(
    expect.objectContaining({ link: card.link }),
  );
  expect(wx.config).toHaveBeenCalledWith(expect.objectContaining({ ...signature, debug: false }));
});
it('does not apply a stale group invitation if the dialog closes before verification', async () => {
  const controller = new AbortController();
  const pending = configureWechatShare(signature, card, controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(wx.config).toHaveBeenCalled());
  controller.abort();
  ready();
  await rejected;
  expect(wx.updateAppMessageShareData).not.toHaveBeenCalled();
});
