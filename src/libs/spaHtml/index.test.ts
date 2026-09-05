import { describe, expect, it } from 'vitest';

import { resolveViteBrowserOrigin, resolveViteSpaTemplatePath } from './index';

describe('resolveViteSpaTemplatePath', () => {
  it('selects the mobile Vite entry for mobile requests', () => {
    expect(resolveViteSpaTemplatePath(true)).toBe('/index.mobile.html');
  });

  it('keeps the default Vite entry for desktop requests', () => {
    expect(resolveViteSpaTemplatePath(false)).toBe('/');
  });
});

describe('resolveViteBrowserOrigin', () => {
  it('keeps localhost assets local for a localhost request', () => {
    expect(
      resolveViteBrowserOrigin(
        'http://localhost:3010/lobehub/signin',
        'http://localhost:9876',
      ),
    ).toBe('http://localhost:9876');
  });

  it('uses the LAN request host for browser-loaded Vite assets', () => {
    expect(
      resolveViteBrowserOrigin(
        'http://127.0.0.1:3011/signin',
        'http://localhost:9876',
        '192.168.31.29:3010',
      ),
    ).toBe('http://192.168.31.29:9876');
  });

  it('does not reflect an arbitrary public host into a Vite asset URL', () => {
    expect(
      resolveViteBrowserOrigin(
        'http://127.0.0.1:3011/signin',
        'http://localhost:9876',
        'attacker.example',
      ),
    ).toBe('http://localhost:9876');
  });

  it('falls back safely when a forwarded host is malformed', () => {
    expect(
      resolveViteBrowserOrigin(
        'http://127.0.0.1:3011/signin',
        'http://localhost:9876',
        '[invalid',
      ),
    ).toBe('http://localhost:9876');
  });
});
