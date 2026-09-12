import { withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';

interface ShareCard {
  desc: string;
  imgUrl: string;
  link: string;
  title: string;
}
interface Signature {
  appId: string;
  nonceStr: string;
  signature: string;
  timestamp: number;
}
interface WechatSdk {
  config: (options: Signature & { debug: boolean; jsApiList: string[] }) => void;
  error: (callback: () => void) => void;
  ready: (callback: () => void) => void;
  updateAppMessageShareData: (data: ShareCard & { fail: () => void; success: () => void }) => void;
  updateTimelineShareData: (data: ShareCard & { fail: () => void; success: () => void }) => void;
}
const sdkWindow = () => window as Window & { wx?: WechatSdk };
let loading: Promise<WechatSdk> | undefined;
const loadSdk = () => {
  if (sdkWindow().wx) return Promise.resolve(sdkWindow().wx!);
  if (!loading) {
    loading = new Promise<WechatSdk>((resolve, reject) => {
      const script = document.createElement('script');
      const fail = () => {
        clearTimeout(timeout);
        script.remove();
        reject(new Error('WECHAT_SDK_LOAD_FAILED'));
      };
      const timeout = setTimeout(fail, 12000);
      script.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
      script.async = true;
      script.onerror = fail;
      script.onload = () => {
        clearTimeout(timeout);
        const sdk = sdkWindow().wx;
        if (sdk) resolve(sdk);
        else fail();
      };
      document.head.append(script);
    }).catch((error) => {
      loading = undefined;
      throw error;
    });
  }
  return loading;
};

export const isWechatBrowser = () => /MicroMessenger/i.test(navigator.userAgent);

export const wechatSigningUrl = () => {
  // iOS WeChat verifies the document's entry URL even after SPA navigation.
  const entry = performance.getEntriesByType('navigation')[0]?.name;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) && entry ? entry : window.location.href
  ).split('#')[0];
};

export async function configureWechatShare(
  signature: Signature,
  card: ShareCard,
  signal: AbortSignal,
) {
  const sdk = await loadSdk();
  if (signal.aborted) throw new Error('WECHAT_SHARE_CANCELLED');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => finish(new Error('WECHAT_SHARE_CANCELLED'));
    const fail = () => finish(new Error('WECHAT_SHARE_FAILED'));
    const timeout = setTimeout(fail, 12000);
    signal.addEventListener('abort', cancel, { once: true });
    sdk.error(fail);
    sdk.config({
      ...signature,
      debug: false,
      jsApiList: ['updateAppMessageShareData', 'updateTimelineShareData'],
    });
    sdk.ready(() => {
      if (signal.aborted || settled) return;
      let remaining = 2;
      const success = () => {
        if (--remaining === 0) finish();
      };
      try {
        sdk.updateAppMessageShareData({ ...card, success, fail });
        sdk.updateTimelineShareData({ ...card, success, fail });
      } catch {
        fail();
      }
    });
  });
}

export function clearWechatInvitation() {
  const sdk = sdkWindow().wx;
  if (!sdk) return;
  const card = {
    title: document.title,
    desc: '',
    link: window.location.origin,
    imgUrl: new URL(withLobeHubMountPath('/app-icons/icon-192x192.png'), window.location.origin)
      .href,
    success: () => {},
    fail: () => {},
  };
  try {
    sdk.updateAppMessageShareData(card);
    sdk.updateTimelineShareData(card);
  } catch {
    /* SDK may not yet be ready. */
  }
}
