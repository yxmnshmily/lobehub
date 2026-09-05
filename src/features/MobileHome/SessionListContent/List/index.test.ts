import { describe, expect, it } from 'vitest';

import { resolveSessionUrl } from './index';

describe('resolveSessionUrl', () => {
  it('opens agent-group sessions with the group id', () => {
    expect(resolveSessionUrl({ id: 'cg_group', mobile: true, type: 'group' })).toBe(
      '/group/cg_group',
    );
  });

  it('opens agent sessions with their configured agent id', () => {
    expect(
      resolveSessionUrl({ agentId: 'agt_agent', id: 'session', mobile: true, type: 'agent' }),
    ).toBe('/agent/agt_agent');
  });
});
