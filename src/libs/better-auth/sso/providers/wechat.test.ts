import { afterEach, describe, expect, it, vi } from 'vitest';

import provider from './wechat';

vi.mock('@/envs/auth', () => ({ authEnv: {} }));

describe('WeChat OAuth provider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects an HTTP 200 WeChat business error returned by userinfo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errcode: 40003, errmsg: 'invalid openid' }), { status: 200 }),
    );
    const config = provider.build({ AUTH_WECHAT_ID: 'id', AUTH_WECHAT_SECRET: 'secret' });

    await expect(
      config.getUserInfo!({ accessToken: 'token', raw: { openid: 'openid' } } as never),
    ).resolves.toBeNull();
  });

  it('applies an abort signal to token and userinfo requests', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ access_token: 'token', expires_in: 300, openid: 'openid' }),
            { status: 200 },
          ),
      );
    const config = provider.build({ AUTH_WECHAT_ID: 'id', AUTH_WECHAT_SECRET: 'secret' });

    const tokens = await config.getToken!({ code: 'code', redirectURI: 'https://example.test' });
    await config.getUserInfo!(tokens as never);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchSpy.mock.calls) expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
