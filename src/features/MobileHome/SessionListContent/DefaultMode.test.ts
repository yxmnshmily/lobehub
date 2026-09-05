import { describe, expect, it } from 'vitest';

import { filterSessionsForDevice } from './DefaultMode';

describe('filterSessionsForDevice', () => {
  it('keeps group conversations visible on mobile', () => {
    const sessions = [
      { id: 'cg_group', type: 'group' },
      { config: { id: 'agt_agent' }, id: 'session', type: 'agent' },
    ] as any;

    expect(filterSessionsForDevice(sessions, true).map((session) => session.id)).toEqual([
      'cg_group',
      'session',
    ]);
  });
});
