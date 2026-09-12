import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const compose = parse(
  readFileSync(
    path.resolve(import.meta.dirname, '../docker-compose/dev/docker-compose.yml'),
    'utf8',
  ),
) as {
  services: Record<
    string,
    {
      healthcheck?: { test: string[] };
      restart?: string;
    }
  >;
};

describe('development docker-compose storage', () => {
  it('keeps RustFS healthy and running so stored previews remain available', () => {
    const rustfs = compose.services.rustfs;

    expect(rustfs.restart).toBe('always');
    expect(rustfs.healthcheck?.test.join(' ')).toContain('/health');
  });
});
