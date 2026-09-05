import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const mascotPath = '/lobehub/app-icons/travel-cloud-mascot.png';

describe('share app brand icon', () => {
  it('uses the cloud mascot in both static and React Router document shells', () => {
    const staticShell = readFileSync(path.join(process.cwd(), 'apps/share/index.html'), 'utf8');
    const routerShell = readFileSync(path.join(process.cwd(), 'apps/share/app/root.tsx'), 'utf8');

    expect(staticShell).toContain(mascotPath);
    expect(routerShell).toContain('BRANDING_LOGO_URL');
    expect(routerShell).toContain('href={BRANDING_LOGO_URL}');
    expect(staticShell).not.toContain('href="/favicon.ico"');
    expect(staticShell).not.toContain('href="/favicon-32x32.ico"');
    expect(routerShell).not.toContain('href="/favicon.ico"');
  });
});
