import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchViteDevTemplate,
  resolveViteBrowserOrigin,
  resolveViteSpaTemplatePath,
} from './index';

afterEach(() => vi.unstubAllGlobals());

it('resolves the share entry against its Vite directory, not the public share URL', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          '<html><head></head><body><script type="module" src="./src/entry.tsx"></script></body></html>',
        ),
      ),
  );
  const html = await fetchViteDevTemplate('/apps/share/index.html', 'http://localhost:9876');
  expect(html).toContain('src="http://localhost:9876/apps/share/src/entry.tsx"');
});

describe('resolveViteSpaTemplatePath', () => {
  it('always serves the desktop Vite entry (mobile build removed)', () => {
    expect(resolveViteSpaTemplatePath()).toBe('/');
  });
});

describe('resolveViteBrowserOrigin', () => {
  it('keeps localhost assets local for a localhost request', () => {
    expect(
      resolveViteBrowserOrigin('http://localhost:3010/lobehub/signin', 'http://localhost:9876'),
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
      resolveViteBrowserOrigin('http://127.0.0.1:3011/signin', 'http://localhost:9876', '[invalid'),
    ).toBe('http://localhost:9876');
  });
});
