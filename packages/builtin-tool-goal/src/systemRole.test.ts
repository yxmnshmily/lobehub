import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('Goal systemPrompt', () => {
  it('hands successful goal execution off instead of duplicating it', () => {
    expect(systemPrompt).toContain(
      'the goal owns decomposition, dispatch and acceptance',
    );
    expect(systemPrompt).toContain('do not reproduce its work in the main conversation');
  });

  it('creates the goal immediately instead of downgrading to a task chain', () => {
    expect(systemPrompt).toContain('creates the goal immediately in this group');
    expect(systemPrompt).toContain('do not downgrade to a task chain');
  });
});
