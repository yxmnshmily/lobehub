import { describe, expect, it } from 'vitest';

import { resolveActiveTab } from './resolveActiveTab';

describe('resolveActiveTab', () => {
  it('falls back to group settings when a member tab belongs to another group', () => {
    expect(resolveActiveTab('agent-from-group-a', ['agent-from-group-b'])).toBe('group');
    expect(resolveActiveTab('agent-from-group-b', ['agent-from-group-b'])).toBe(
      'agent-from-group-b',
    );
  });
});
