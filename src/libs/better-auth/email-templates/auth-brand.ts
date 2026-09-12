import path from 'node:path';

import { BRANDING_LOGO_URL, BRANDING_NAME } from '@lobechat/business-const';
import addressparser from 'nodemailer/lib/addressparser';
import { z } from 'zod';

import { EMAIL_SUPPORT_ADDRESS } from '@/libs/email/support';

const LOBEHUB_MOUNT_PATH = '/lobehub';
const AUTH_CALLBACK_QUERY_KEYS = [
  'callbackURL',
  'errorCallbackURL',
  'newUserCallbackURL',
  'redirectTo',
] as const;
const hasUnsafeCallbackCharacter = (value: string): boolean =>
  value.includes('\\') ||
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });

export const AUTH_EMAIL_BRAND_NAME = BRANDING_NAME;
export const AUTH_EMAIL_BRAND_LOGO_URL = BRANDING_LOGO_URL;

export const getAuthEmailSender = (configuredFrom?: string): string | undefined => {
  if (!configuredFrom || /[\r\n]/.test(configuredFrom)) return undefined;

  const mailboxes = addressparser(configuredFrom, { flatten: true });
  const address = mailboxes.length === 1 ? mailboxes[0]?.address : undefined;
  if (!address || !z.email().safeParse(address).success) return undefined;

  return `${AUTH_EMAIL_BRAND_NAME} <${address}>`;
};

const getBrandLogoAttachmentPath = (publicUrl: string): string => {
  const publicPath = new URL(publicUrl, 'https://brand.invalid').pathname;
  const mountedPrefix = `${LOBEHUB_MOUNT_PATH}/`;
  const unmountedPath = publicPath.startsWith(mountedPrefix)
    ? publicPath.slice(LOBEHUB_MOUNT_PATH.length)
    : publicPath;
  const publicRoot = path.resolve(process.cwd(), 'public');
  const resolvedPath = path.resolve(publicRoot, unmountedPath.replace(/^\/+/, ''));

  if (!resolvedPath.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error('Authentication email logo must resolve inside the public directory');
  }

  return resolvedPath;
};

const brandLogoPath = getBrandLogoAttachmentPath(AUTH_EMAIL_BRAND_LOGO_URL);

export const escapeEmailHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const AUTH_EMAIL_WECHAT = 'jinwang1016';
const getAuthEmailSupportHtml = () => {
  const supportEmail = escapeEmailHtml(EMAIL_SUPPORT_ADDRESS);

  return `联系${escapeEmailHtml(AUTH_EMAIL_BRAND_NAME)}：<a href="mailto:${supportEmail}" style="color: #6b7280; text-decoration: underline;">${supportEmail}</a><span style="color: #a1a1aa;"> · </span><span style="color: #6b7280;">微信号：${AUTH_EMAIL_WECHAT}</span>`;
};
const getAuthEmailSupportText = () =>
  `联系${AUTH_EMAIL_BRAND_NAME}：${EMAIL_SUPPORT_ADDRESS}、微信号：${AUTH_EMAIL_WECHAT}`;

export const travelGroupLogoAttachment = {
  cid: 'travel-group-logo',
  filename: 'travel-group-logo.png',
  path: brandLogoPath,
};

const normalizeMountedCallback = (callback: string, configuredOrigin: string): string => {
  let decoded = callback;
  let fullyDecoded = false;
  for (let pass = 0; pass < 8; pass++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        fullyDecoded = true;
        break;
      }
      decoded = next;
    } catch {
      return `${LOBEHUB_MOUNT_PATH}/`;
    }
  }

  if (!fullyDecoded || hasUnsafeCallbackCharacter(decoded)) return `${LOBEHUB_MOUNT_PATH}/`;

  try {
    const parsed = new URL(callback, configuredOrigin);
    const decodedParsed = new URL(decoded, configuredOrigin);
    const isMounted = (pathname: string) =>
      pathname === LOBEHUB_MOUNT_PATH || pathname.startsWith(`${LOBEHUB_MOUNT_PATH}/`);

    if (
      parsed.origin !== configuredOrigin ||
      decodedParsed.origin !== configuredOrigin ||
      !isMounted(parsed.pathname) ||
      !isMounted(decodedParsed.pathname)
    ) {
      return `${LOBEHUB_MOUNT_PATH}/`;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return `${LOBEHUB_MOUNT_PATH}/`;
  }
};

export const getMountedAuthEmailUrl = (url: string, configuredAppUrl: string): string => {
  const configuredOrigin = new URL(configuredAppUrl).origin;
  const authUrl = new URL(url, configuredOrigin);
  for (const key of AUTH_CALLBACK_QUERY_KEYS) {
    const callback = authUrl.searchParams.get(key);
    if (callback)
      authUrl.searchParams.set(key, normalizeMountedCallback(callback, configuredOrigin));
  }
  const mountedPath =
    authUrl.pathname === LOBEHUB_MOUNT_PATH || authUrl.pathname.startsWith(`${LOBEHUB_MOUNT_PATH}/`)
      ? authUrl.pathname
      : `${LOBEHUB_MOUNT_PATH}${authUrl.pathname.startsWith('/') ? '' : '/'}${authUrl.pathname}`;
  const mountedUrl = new URL(mountedPath, configuredOrigin);
  mountedUrl.search = authUrl.search;
  mountedUrl.hash = authUrl.hash;

  return mountedUrl.toString();
};

export const getTravelGroupEmailFooterText = () =>
  `${AUTH_EMAIL_BRAND_NAME}｜旅游内容与 AI 创作服务平台\n${getAuthEmailSupportText()}`;

export const renderTravelGroupAuthEmail = ({
  content,
  title,
}: {
  content: string;
  title: string;
}) => `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeEmailHtml(title)}｜${escapeEmailHtml(AUTH_EMAIL_BRAND_NAME)}</title>
</head>
<body style="margin:0;padding:0;background:#f8f8f8;color:#080808;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8f8f8;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
        <tr><td align="center" style="padding:0 0 24px;">
          <img src="cid:travel-group-logo" width="80" height="80" alt="${escapeEmailHtml(AUTH_EMAIL_BRAND_NAME)} Logo" style="display:block;width:80px;height:80px;border:0;">
          <div style="margin-top:12px;font-size:22px;line-height:30px;font-weight:700;color:#080808;">${escapeEmailHtml(AUTH_EMAIL_BRAND_NAME)}</div>
          <div style="margin-top:4px;font-size:14px;line-height:22px;color:#666666;">旅游内容与 AI 创作服务平台</div>
        </td></tr>
        <tr><td style="padding:36px 32px;background:#ffffff;border:0.5px solid #e3e3e3;border-radius:16px;">
          <h1 style="margin:0 0 24px;font-size:26px;line-height:36px;text-align:center;color:#080808;">${escapeEmailHtml(title)}</h1>
          ${content}
        </td></tr>
        <tr><td align="center" style="padding:24px 12px 0;font-size:13px;line-height:22px;color:#999999;">
          <p style="margin:0 0 8px;">${escapeEmailHtml(AUTH_EMAIL_BRAND_NAME)}面向旅游从业者，提供旅游文案、在线作图、视频生成、文档制作和多人 AI 协作服务。</p>
          <p style="margin:0 0 6px;">${getAuthEmailSupportHtml()}</p>
          <p style="margin:0;">© ${new Date().getFullYear()} ${escapeEmailHtml(AUTH_EMAIL_BRAND_NAME)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
