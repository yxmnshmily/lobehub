import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('unsupported browser page branding', () => {
  it('uses the customer-facing product name and cloud mascot favicon', () => {
    const html = readFileSync(path.join(process.cwd(), 'public/not-compatible.html'), 'utf8');

    expect(html).toContain('Browser Not Compatible - 旅游群网');
    expect(html).toContain('run 旅游群网 properly');
    expect(html).toContain('无法正常运行旅游群网');
    expect(html).toContain('href="/lobehub/app-icons/travel-cloud-mascot.png"');
    expect(html).not.toContain('href="/favicon.ico"');
    expect(html).not.toContain('LobeHub');
  });
});
