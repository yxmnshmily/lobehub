import { existsSync } from 'node:fs';

import { BRANDING_LOGO_URL, BRANDING_NAME } from '@lobechat/business-const';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';

import {
  AUTH_EMAIL_BRAND_LOGO_URL,
  AUTH_EMAIL_BRAND_NAME,
  getAuthEmailSender,
  getChangeEmailVerificationTemplate,
  getMagicLinkEmailTemplate,
  getMountedAuthEmailUrl,
  getResetPasswordEmailTemplate,
  getVerificationEmailTemplate,
  getVerificationOTPEmailTemplate,
  getWorkspaceInviteEmailTemplate,
  getWorkspaceMemberRemovedEmailTemplate,
} from './index';

const travelGroupAuthTemplates = [
  getChangeEmailVerificationTemplate({
    expiresInSeconds: 3600,
    url: 'https://example.com/change-email',
  }),
  getMagicLinkEmailTemplate({
    expiresInSeconds: 600,
    url: 'https://example.com/sign-in',
  }),
  getResetPasswordEmailTemplate({ url: 'https://example.com/reset-password' }),
  getVerificationEmailTemplate({
    expiresInSeconds: 3600,
    url: 'https://example.com/verify-email',
  }),
  getVerificationOTPEmailTemplate({ expiresInSeconds: 600, otp: '123456' }),
];

const workspaceTemplates = [
  getWorkspaceInviteEmailTemplate({
    expiresInDays: 7,
    role: 'member',
    url: 'https://example.com/invite',
    workspaceName: 'Example Workspace',
  }),
  getWorkspaceMemberRemovedEmailTemplate({
    reason: 'removed_by_owner',
    workspaceName: 'Example Workspace',
  }),
];

describe('email templates', () => {
  it('uses the repository brand configuration and real cloud mascot asset', () => {
    expect(AUTH_EMAIL_BRAND_NAME).toBe(BRANDING_NAME);
    expect(AUTH_EMAIL_BRAND_NAME).toBe('旅游群网');
    expect(AUTH_EMAIL_BRAND_LOGO_URL).toBe(BRANDING_LOGO_URL);
    expect(AUTH_EMAIL_BRAND_LOGO_URL).toBe('/lobehub/app-icons/travel-cloud-mascot.png');
  });

  it.each([
    ['LobeHub <noreply@example.test>', '旅游群网 <noreply@example.test>'],
    ['noreply@example.test', '旅游群网 <noreply@example.test>'],
    ['QQ Mail <123456789@qq.com>', '旅游群网 <123456789@qq.com>'],
  ])('forces the Better Auth sender display name for %s', (configuredFrom, expected) => {
    expect(getAuthEmailSender(configuredFrom)).toBe(expected);
    expect(getAuthEmailSender(configuredFrom)).not.toContain('LobeHub');
  });

  it.each(['', 'one@example.test, two@example.test', 'bad\r\nBcc: victim@example.test'])(
    'rejects an empty or ambiguous authentication sender: %j',
    (configuredFrom) => {
      expect(getAuthEmailSender(configuredFrom)).toBeUndefined();
    },
  );

  it('keeps a compact snapshot for every Better Auth customer mail', () => {
    const url = 'https://travel.example.test/lobehub/api/auth/action?token=fixture';
    const cases = [
      {
        kind: '注册验证',
        template: getVerificationEmailTemplate({
          expiresInSeconds: 3600,
          url,
          userName: '张三',
        }),
      },
      {
        kind: '验证重发',
        template: getVerificationEmailTemplate({
          expiresInSeconds: 3600,
          url,
          userName: '张三',
        }),
      },
      { kind: '密码重置', template: getResetPasswordEmailTemplate({ url }) },
      {
        kind: '改邮箱',
        template: getChangeEmailVerificationTemplate({
          expiresInSeconds: 3600,
          url,
          userName: '张三',
        }),
      },
      {
        kind: 'OTP',
        template: getVerificationOTPEmailTemplate({
          expiresInSeconds: 300,
          otp: '123456',
          userName: '张三',
        }),
      },
      {
        kind: 'Magic Link',
        template: getMagicLinkEmailTemplate({ expiresInSeconds: 900, url }),
      },
    ];

    expect(
      cases.map(({ kind, template }) => {
        const { document } = parseHTML(template.html);
        return {
          action: document.querySelector('a[target="_blank"]')?.textContent.trim() || null,
          brand: document.querySelector('img')?.getAttribute('alt'),
          heading: document.querySelector('h1')?.textContent.trim(),
          kind,
          subject: template.subject,
          textFallback: Boolean(template.text.trim()),
        };
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "action": "验证邮箱并继续",
          "brand": "旅游群网 Logo",
          "heading": "验证你的邮箱",
          "kind": "注册验证",
          "subject": "请验证你的邮箱｜旅游群网",
          "textFallback": true,
        },
        {
          "action": "验证邮箱并继续",
          "brand": "旅游群网 Logo",
          "heading": "验证你的邮箱",
          "kind": "验证重发",
          "subject": "请验证你的邮箱｜旅游群网",
          "textFallback": true,
        },
        {
          "action": "重置密码",
          "brand": "旅游群网 Logo",
          "heading": "重置你的密码",
          "kind": "密码重置",
          "subject": "重置密码｜旅游群网",
          "textFallback": true,
        },
        {
          "action": "确认新邮箱",
          "brand": "旅游群网 Logo",
          "heading": "确认你的新邮箱",
          "kind": "改邮箱",
          "subject": "确认新邮箱｜旅游群网",
          "textFallback": true,
        },
        {
          "action": null,
          "brand": "旅游群网 Logo",
          "heading": "验证你的邮箱",
          "kind": "OTP",
          "subject": "邮箱验证码｜旅游群网",
          "textFallback": true,
        },
        {
          "action": "登录旅游群网",
          "brand": "旅游群网 Logo",
          "heading": "登录你的账号",
          "kind": "Magic Link",
          "subject": "登录链接｜旅游群网",
          "textFallback": true,
        },
      ]
    `);
  });

  it('brands signup verification as 旅游群网 with the real support channels', () => {
    const template = getVerificationEmailTemplate({
      expiresInSeconds: 3600,
      url: 'https://example.com/verify-email',
      userName: '旅行伙伴',
    });

    expect(template.subject).toBe('请验证你的邮箱｜旅游群网');
    expect(template.html).toContain('cid:travel-group-logo');
    expect(template.html).toContain('旅游群网面向旅游从业者');
    expect(template.html).toContain('微信号：jinwang1016');
    expect(template.html).not.toContain('jinwang1016@163.com');
    expect(template.html).toContain('yxmnshmily@qq.com');
    expect(template.attachments).toEqual([
      expect.objectContaining({ cid: 'travel-group-logo', filename: 'travel-group-logo.png' }),
    ]);
    expect(template.text).toContain('旅游群网');
    expect(template.text).toContain('https://example.com/verify-email');
  });

  it('escapes customer-controlled verification fields in HTML', () => {
    const template = getVerificationEmailTemplate({
      expiresInSeconds: 3600,
      url: 'https://example.com/verify?next=" onclick="alert(1)',
      userName: '<img src=x onerror=alert(1)>',
    });

    expect(template.html).not.toContain('<img src=x');
    expect(template.html).not.toContain(' onclick="alert(1)');
    expect(template.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(template.html).toContain('&quot; onclick=&quot;alert(1)');
  });

  it('escapes a malicious nickname in every auth template that accepts one', () => {
    const maliciousName = '<img src=x onerror="steal()">';
    const templates = [
      getVerificationEmailTemplate({
        expiresInSeconds: 3600,
        url: 'https://example.com/verify-email',
        userName: maliciousName,
      }),
      getChangeEmailVerificationTemplate({
        expiresInSeconds: 3600,
        url: 'https://example.com/change-email',
        userName: maliciousName,
      }),
      getVerificationOTPEmailTemplate({
        expiresInSeconds: 300,
        otp: '123456',
        userName: maliciousName,
      }),
    ];

    for (const template of templates) {
      expect(template.html).not.toContain('<img src=x');
      expect(template.html).toContain('&lt;img src=x onerror=&quot;steal()&quot;&gt;');
    }
  });

  it.each(travelGroupAuthTemplates)(
    'brands customer authentication mail as 旅游群网 with the cloud mascot',
    (template) => {
      expect(template.subject).toContain('旅游群网');
      expect(template.subject.length).toBeLessThanOrEqual(24);
      expect(template.html.trim().length).toBeGreaterThan(0);
      expect(template.text.trim().length).toBeGreaterThan(0);
      expect(template.html).toContain('cid:travel-group-logo');
      expect(template.html).toContain('yxmnshmily@qq.com');
      expect(template.html).toContain('微信号：jinwang1016');
      expect(template.html).not.toContain('jinwang1016@163.com');
      expect(template.html).not.toContain('LobeHub');
      expect(template.html).not.toContain('Lobe AI');
      expect(template.html).not.toContain('🤯');
      expect(template.attachments).toEqual([
        expect.objectContaining({ cid: 'travel-group-logo', filename: 'travel-group-logo.png' }),
      ]);
      expect(existsSync(template.attachments[0].path)).toBe(true);
      expect(template.text).toContain('旅游群网');
      expect(template.text).toContain('yxmnshmily@qq.com');
      expect(template.text).not.toContain('LobeHub');
      expect(template.text).not.toContain('Lobe AI');

      const { document } = parseHTML(template.html);
      expect(document.querySelector('script')).toBeNull();
      expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
      const images = [...document.querySelectorAll('img')];
      expect(images).toHaveLength(1);
      expect(images[0].getAttribute('src')).toBe('cid:travel-group-logo');
      expect(images[0].getAttribute('alt')).toBe('旅游群网 Logo');
      expect(images[0].getAttribute('width')).not.toBe('1');
      expect(images[0].getAttribute('height')).not.toBe('1');
      expect(template.html).not.toMatch(/https?:\/\/(?:bit\.ly|t\.co|tinyurl\.com)\b/i);
    },
  );

  it('rebuilds every clickable authentication link with the configured origin and mount path', () => {
    const mountedUrl = getMountedAuthEmailUrl(
      'http://internal.example.test/api/auth/verify-email?state=fixture',
      'https://travel.example.test/application',
    );
    expect(new URL(mountedUrl).origin).toBe('https://travel.example.test');
    expect(new URL(mountedUrl).pathname).toBe('/lobehub/api/auth/verify-email');
    expect(mountedUrl).not.toContain('internal.example.test');
    expect(getMountedAuthEmailUrl(mountedUrl, 'https://travel.example.test')).toBe(mountedUrl);

    const linkedTemplates = [
      getVerificationEmailTemplate({ expiresInSeconds: 3600, url: mountedUrl }),
      getResetPasswordEmailTemplate({ url: mountedUrl }),
      getChangeEmailVerificationTemplate({ expiresInSeconds: 3600, url: mountedUrl }),
      getMagicLinkEmailTemplate({ expiresInSeconds: 600, url: mountedUrl }),
    ];

    for (const template of linkedTemplates) {
      const { document } = parseHTML(template.html);
      const webLinks = [...document.querySelectorAll('a')]
        .map((anchor) => anchor.getAttribute('href'))
        .filter((href): href is string => Boolean(href?.startsWith('http')));

      expect(webLinks.length).toBeGreaterThan(0);
      expect(new Set(webLinks)).toEqual(new Set([mountedUrl]));
      expect(template.text).toContain(mountedUrl);
      expect(template.html).not.toContain('internal.example.test');
    }
  });

  it.each([
    'https://evil.example/callback',
    '//evil.example/callback',
    '/%2F%2Fevil.example/callback',
    '/%255C%255Cevil.example/callback',
    '/lobehub/%2525252e%2525252e/%2525252e%2525252e/evil',
    'javascript:alert(1)',
  ])('replaces an unsafe nested auth callback with the mounted fallback: %s', (callbackURL) => {
    const rawUrl = new URL('http://internal.example.test/api/auth/action');
    rawUrl.searchParams.set('callbackURL', callbackURL);

    const mountedUrl = getMountedAuthEmailUrl(rawUrl.toString(), 'https://travel.example.test');
    const parsed = new URL(mountedUrl);

    expect(parsed.origin).toBe('https://travel.example.test');
    expect(parsed.pathname).toBe('/lobehub/api/auth/action');
    expect(parsed.searchParams.get('callbackURL')).toBe('/lobehub/');
  });

  it('canonicalizes a configured-origin absolute callback to a mounted relative path', () => {
    const rawUrl = new URL('http://internal.example.test/api/auth/action');
    rawUrl.searchParams.set(
      'callbackURL',
      'https://travel.example.test/lobehub/settings/profile?tab=security',
    );

    const mountedUrl = getMountedAuthEmailUrl(rawUrl.toString(), 'https://travel.example.test');

    expect(new URL(mountedUrl).searchParams.get('callbackURL')).toBe(
      '/lobehub/settings/profile?tab=security',
    );
  });

  it.each([
    {
      appUrl: 'https://travel.example.test/lobehub',
      expectedOrigin: 'https://travel.example.test',
      rawUrl: 'http://localhost:3011/api/auth/verify-email?token=secret-fixture',
    },
    {
      appUrl: 'https://travel.example.test',
      expectedOrigin: 'https://travel.example.test',
      rawUrl: 'http://127.0.0.1:3012/api/auth/reset-password?token=secret-fixture',
    },
    {
      appUrl: 'https://travel.example.test',
      expectedOrigin: 'https://travel.example.test',
      rawUrl: 'https://host-header-attacker.example/api/auth/magic-link?token=secret-fixture',
    },
    {
      appUrl: 'http://localhost:3010/lobehub',
      expectedOrigin: 'http://localhost:3010',
      rawUrl: 'http://localhost:3011/api/auth/verify-email?token=secret-fixture',
    },
  ])(
    'uses only configured public/development base $appUrl instead of the raw link host',
    ({ appUrl, expectedOrigin, rawUrl }) => {
      const mountedUrl = getMountedAuthEmailUrl(rawUrl, appUrl);

      expect(new URL(mountedUrl).origin).toBe(expectedOrigin);
      expect(new URL(mountedUrl).pathname).toMatch(/^\/lobehub\/api\/auth\//);
      expect(mountedUrl).not.toContain('3011');
      expect(mountedUrl).not.toContain('3012');
      expect(mountedUrl).not.toContain('host-header-attacker.example');
    },
  );

  it.each(['callbackURL', 'errorCallbackURL', 'newUserCallbackURL', 'redirectTo'] as const)(
    'applies the same-origin mounted allowlist to %s',
    (callbackKey) => {
      const rawUrl = new URL('http://127.0.0.1:3012/api/auth/action');
      rawUrl.searchParams.set(callbackKey, 'https://attacker.example/steal');

      const mountedUrl = getMountedAuthEmailUrl(
        rawUrl.toString(),
        'https://travel.example.test/lobehub',
      );

      expect(new URL(mountedUrl).searchParams.get(callbackKey)).toBe('/lobehub/');
    },
  );

  it('does not log action tokens while canonicalizing an email URL', () => {
    const spies = [
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ];

    try {
      getMountedAuthEmailUrl(
        'http://127.0.0.1:3012/api/auth/verify-email?token=never-log-this-token',
        'https://travel.example.test/lobehub',
      );
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it.each(workspaceTemplates)('keeps workspace lifecycle email support reachable', (template) => {
    expect(template.html).toContain('mailto:yxmnshmily@qq.com');
    expect(template.html).toContain('mailto:jinwang1016@163.com');
    expect(template.text).toContain('yxmnshmily@qq.com');
  });
});
