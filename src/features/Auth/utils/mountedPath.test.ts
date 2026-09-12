import { describe, expect, it } from 'vitest';

import {
  buildMountedEmailVerificationResultPath,
  buildMountedOnboardingPath,
  resolveAuthCallbackPath,
  withLobeHubMountPath,
} from './mountedPath';

describe('buildMountedEmailVerificationResultPath', () => {
  it('returns to a branded auth result page without exposing a token', () => {
    const path = buildMountedEmailVerificationResultPath(
      '/lobehub/onboarding?callbackUrl=%2Findex.html',
      'member@example.test',
      '/lobehub/signup',
    );
    const parsed = new URL(path, 'https://example.test');

    expect(parsed.pathname).toBe('/lobehub/verify-email');
    expect(parsed.searchParams.get('status')).toBe('success');
    expect(parsed.searchParams.get('email')).toBe('member@example.test');
    expect(parsed.searchParams.get('callbackUrl')).toBe(
      '/lobehub/onboarding?callbackUrl=%2Findex.html',
    );
    expect(path).not.toContain('token');
  });
});

describe('withLobeHubMountPath', () => {
  it('adds the public mount to auth redirects while LobeHub is mounted', () => {
    expect(withLobeHubMountPath('/reset-password?email=a%40example.com', '/lobehub/signin')).toBe(
      '/lobehub/reset-password?email=a%40example.com',
    );
    expect(withLobeHubMountPath('/settings/profile', '/lobehub/settings/profile')).toBe(
      '/lobehub/settings/profile',
    );
  });

  it('keeps standalone and already-mounted paths unchanged', () => {
    expect(withLobeHubMountPath('/settings/profile', '/settings/profile')).toBe(
      '/settings/profile',
    );
    expect(withLobeHubMountPath('/lobehub/settings/profile', '/lobehub/settings/profile')).toBe(
      '/lobehub/settings/profile',
    );
  });
});

describe('resolveAuthCallbackPath', () => {
  it.each(['https://evil.example/callback', '//evil.example', 'javascript:alert(1)'])(
    'falls back inside the active mount for an unsafe callback: %s',
    (callbackUrl) => {
      expect(resolveAuthCallbackPath(callbackUrl, '/lobehub/signin')).toBe(
        '/lobehub/group/default',
      );
    },
  );

  it('preserves an explicit website callback shared with the mounted account flow', () => {
    expect(resolveAuthCallbackPath('/index.html', '/lobehub/signin')).toBe('/index.html');
  });

  it.each([null, undefined, '', '/', '/lobehub/'])(
    'sends ordinary sign-in to the current user default group: %s',
    (callback) => {
      expect(resolveAuthCallbackPath(callback, '/lobehub/signin')).toBe('/lobehub/group/default');
    },
  );

  it('preserves invitations and explicit group/topic targets', () => {
    for (const path of ['/lobehub/settings/profile?invitation=test', '/lobehub/group/own/topic']) {
      expect(resolveAuthCallbackPath(path, '/lobehub/signin')).toBe(path);
    }
    expect(resolveAuthCallbackPath(null, '/signin')).toBe('/group/default');
  });
});

describe('buildMountedOnboardingPath', () => {
  it('threads the default group through the mounted first signup hop', () => {
    expect(buildMountedOnboardingPath(null, '/lobehub/signup')).toBe(
      '/lobehub/onboarding?callbackUrl=%2Flobehub%2Fgroup%2Fdefault',
    );
    expect(buildMountedOnboardingPath('https://evil.example', '/lobehub/signup')).toBe(
      '/lobehub/onboarding?callbackUrl=%2Flobehub%2Fgroup%2Fdefault',
    );
  });

  it('threads an explicit website destination through mounted onboarding', () => {
    expect(buildMountedOnboardingPath('/index.html', '/lobehub/signup')).toBe(
      '/lobehub/onboarding?callbackUrl=%2Findex.html',
    );
  });
});
