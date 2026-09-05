import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildAuthSeoEntry, buildSeoMeta } from './seoMeta';

describe('buildAuthSeoEntry', () => {
  it('maps /signin to signin metadata', async () => {
    const entry = await buildAuthSeoEntry('en-US', '/signin');

    expect(entry.canonicalPath).toBe('/signin');
    expect(entry.title).toBe('Sign In · 旅游群网');
    expect(entry.description).toContain('account');
  });

  it('maps /signup to signup metadata', async () => {
    const entry = await buildAuthSeoEntry('en-US', '/signup');

    expect(entry.canonicalPath).toBe('/signup');
    expect(entry.title).toBe('Create Account · 旅游群网');
    expect(entry.description).toBe('Start your Agents collaboration space');
  });

  it('uses hand-translated zh-CN keys', async () => {
    const signin = await buildAuthSeoEntry('zh-CN', '/signin');
    const signup = await buildAuthSeoEntry('zh-CN', '/signup');

    expect(signin.title).toBe('登录 · 旅游群网');
    expect(signup.title).toBe('创建账号 · 旅游群网');
    expect(signup.description).toBe('开启 Agents 协作空间');
  });

  it('strips a trailing slash before matching', async () => {
    const entry = await buildAuthSeoEntry('en-US', '/signin/');

    expect(entry.canonicalPath).toBe('/signin');
    expect(entry.title).toBe('Sign In · 旅游群网');
  });

  it('falls back to branding for unmapped paths', async () => {
    const entry = await buildAuthSeoEntry('en-US', '/oauth/consent');

    expect(entry.canonicalPath).toBeUndefined();
    expect(entry.title).toBeTruthy();
    expect(entry.description).toBeTruthy();
  });
});

describe('buildSeoMeta', () => {
  it('generates title and description for mapped paths', async () => {
    const meta = await buildSeoMeta('en-US', '/signin');

    expect(meta).toContain('<title>Sign In · 旅游群网</title>');
    expect(meta).toContain('<meta name="description" content="');
    expect(meta).not.toContain('og:');
    expect(meta).not.toContain('twitter:');
  });

  it('keeps the authentication shell on the travel cloud favicon', () => {
    const template = readFileSync('index.auth.html', 'utf8');

    expect(template).toContain('/lobehub/app-icons/travel-cloud-mascot.png');
    expect(template).not.toContain('href="/favicon.ico"');
  });

  it('normalizes hostile locale input to an allowlisted value', async () => {
    const hostile = '"><script>alert(1)</script>';
    const meta = await buildSeoMeta(hostile, '/signin');

    expect(meta).not.toContain(hostile);
    expect(meta).not.toContain('alert(1)');
    expect(meta).toContain('<title>Sign In · 旅游群网</title>');
  });

  it('falls back to branding for unmapped paths', async () => {
    const meta = await buildSeoMeta('en-US', '/verify-email');

    expect(meta).toContain('<title>');
    expect(meta).not.toContain('og:');
    expect(meta).not.toContain('twitter:');
  });

  it.each([
    ['/verify-email', 'Verify Your Email · 旅游群网'],
    ['/reset-password', 'Reset Password · 旅游群网'],
    ['/auth-error', 'Authentication Error · 旅游群网'],
  ])('uses branded titles for the authentication state page %s', async (pathname, title) => {
    const entry = await buildAuthSeoEntry('en-US', pathname);

    expect(entry.title).toBe(title);
  });
});
