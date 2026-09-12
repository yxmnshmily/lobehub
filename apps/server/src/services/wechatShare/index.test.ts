import { createHash } from 'node:crypto';

import { beforeEach, expect, it, vi } from 'vitest';

import { signWechatPage } from './index';

const cache = vi.hoisted(() => new Map<string, string>());
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://travel.example/lobehub' } }));
vi.mock('@/envs/redis', () => ({ getRedisConfig: () => ({ enabled: true }) }));
vi.mock('@/libs/redis', () => ({
  initializeRedis: async () => ({
    get: async (key: string) => cache.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (cache.has(key)) return null;
      cache.set(key, value);
      return 'OK';
    },
    setex: async (key: string, _ttl: number, value: string) => {
      cache.set(key, value);
    },
    eval: async (_script: string, _count: number, key: string) => cache.delete(key),
  }),
}));
beforeEach(() => {
  cache.clear();
  vi.stubEnv('WECHAT_JS_SDK_APP_ID', 'test-app');
  vi.stubEnv('WECHAT_JS_SDK_APP_SECRET', 'test-secret');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'secret-token', expires_in: 7200 })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errcode: 0, ticket: 'secret-ticket', expires_in: 7200 })),
      ),
  );
});
it('signs the exact page URL without its hash and caches credentials across requests', async () => {
  const result = await signWechatPage('https://travel.example/lobehub/group/g1?a=%2F#hash');
  expect(result).toMatchObject({ appId: 'test-app' });
  const source = `jsapi_ticket=secret-ticket&noncestr=${result.nonceStr}&timestamp=${result.timestamp}&url=https://travel.example/lobehub/group/g1?a=%2F`;
  expect(result.signature).toBe(createHash('sha1').update(source).digest('hex'));
  expect(JSON.stringify(result)).not.toContain('secret-');
  await signWechatPage('https://travel.example/lobehub/group/g2');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([
  'https://evil.example/lobehub',
  'http://travel.example/lobehub',
  'https://user@travel.example/lobehub',
])('rejects an untrusted signing URL: %s', async (url) => {
  await expect(signWechatPage(url)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it('does not fetch credentials when JS-SDK is unconfigured', async () => {
  vi.stubEnv('WECHAT_JS_SDK_APP_SECRET', '');
  await expect(signWechatPage('https://travel.example/lobehub')).rejects.toThrow(
    'WECHAT_SHARE_UNAVAILABLE',
  );
  expect(fetch).not.toHaveBeenCalled();
});
it('sanitizes upstream errors and never caches failed tickets', async () => {
  vi.mocked(fetch).mockReset().mockRejectedValue(new Error('secret-token in upstream URL'));
  await expect(signWechatPage('https://travel.example/lobehub')).rejects.toThrow(
    'WECHAT_SHARE_UNAVAILABLE',
  );
  expect([...cache.values()]).not.toContain('secret-token');
});
