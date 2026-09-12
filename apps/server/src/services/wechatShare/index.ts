import { createHash, randomBytes } from 'node:crypto';

import { appEnv } from '@/envs/app';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis } from '@/libs/redis';

const unavailable = () => new Error('WECHAT_SHARE_UNAVAILABLE');

/** Only sign our public site's pages; secrets and tickets never leave the server. */
export async function signWechatPage(pageUrl: string) {
  try {
    const appId = process.env.WECHAT_JS_SDK_APP_ID;
    const secret = process.env.WECHAT_JS_SDK_APP_SECRET;
    if (!appId || !secret) throw unavailable();
    const page = new URL(pageUrl);
    const site = new URL(appEnv.APP_URL);
    if (
      page.origin !== site.origin ||
      page.protocol !== 'https:' ||
      page.username ||
      page.password
    ) {
      throw unavailable();
    }
    // Keep the original escaping/query order: WeChat signs the actual browser URL.
    const url = pageUrl.split('#')[0];
    const redis = await initializeRedis(getRedisConfig());
    if (!redis) throw unavailable();
    const key = `wechat-js-sdk:${appId}`;
    let ticket = await redis.get(`${key}:ticket`);
    if (!ticket) {
      const lock = randomBytes(16).toString('hex');
      if (!(await redis.set(`${key}:lock`, lock, { nx: true, ex: 30 }))) throw unavailable();
      try {
        ticket = await redis.get(`${key}:ticket`);
        if (!ticket) {
          let token = await redis.get(`${key}:token`);
          if (!token) {
            const response = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                grant_type: 'client_credential',
                appid: appId,
                secret,
                force_refresh: false,
              }),
              signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) throw unavailable();
            const data = await response.json();
            if (data.errcode || typeof data.access_token !== 'string' || !(data.expires_in > 120))
              throw unavailable();
            token = data.access_token as string;
            await redis.setex(`${key}:token`, Math.floor(data.expires_in - 120), token);
          }
          const response = await fetch(
            `https://api.weixin.qq.com/cgi-bin/ticket/getticket?type=jsapi&access_token=${encodeURIComponent(token)}`,
            {
              signal: AbortSignal.timeout(8000),
            },
          );
          if (!response.ok) throw unavailable();
          const data = await response.json();
          if (data.errcode || typeof data.ticket !== 'string' || !(data.expires_in > 120))
            throw unavailable();
          ticket = data.ticket as string;
          await redis.setex(`${key}:ticket`, Math.floor(data.expires_in - 120), ticket);
        }
      } finally {
        await redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
          1,
          `${key}:lock`,
          lock,
        );
      }
    }
    const nonceStr = randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHash('sha1')
      .update(`jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`)
      .digest('hex');
    return { appId, nonceStr, signature, timestamp };
  } catch {
    // Fetch errors can contain access tokens in URLs; never expose upstream errors.
    throw unavailable();
  }
}
