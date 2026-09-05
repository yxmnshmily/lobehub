import { describe, expect, it } from 'vitest';

import { builtinTools } from './index';

describe('builtin tool registry', () => {
  it('keeps agent management out of explicit activation discovery', () => {
    const tool = builtinTools.find((item) => item.identifier === 'lobe-agent-management');

    expect(tool).toMatchObject({ discoverable: false, hidden: true });
  });
});
