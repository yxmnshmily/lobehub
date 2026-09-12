import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { mobileHtmlTemplate } from './spa/[variants]/[[...path]]/mobileHtmlTemplate.source';

const WEB_ENTRY_POINTS = [
  'index.html',
  'index.mobile.html',
  'index.auth.html',
  'index.workbench.html',
  'apps/share/index.html',
  'apps/workbench/index.html',
];

const viewportContent = (html: string) =>
  html.match(/<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i)?.[1];

describe('responsive viewport configuration', () => {
  it.each(WEB_ENTRY_POINTS)('exposes safe-area insets in %s', (entryPoint) => {
    const html = readFileSync(path.resolve(process.cwd(), entryPoint), 'utf8');

    expect(viewportContent(html)).toContain('viewport-fit=cover');
  });

  it('keeps the committed mobile SPA template aligned with the mobile entry point', () => {
    expect(viewportContent(mobileHtmlTemplate)).toContain('viewport-fit=cover');
  });

  it('exposes safe-area insets from the Next.js root layout', async () => {
    const rootLayout = await import('./layout');

    expect(rootLayout.viewport).toMatchObject({ viewportFit: 'cover' });
  });
});
