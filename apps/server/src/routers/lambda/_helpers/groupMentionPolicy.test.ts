import { describe, expect, it } from 'vitest';

import { createGroupMentionPolicy } from './groupMentionPolicy';

describe('group mention routing', () => {
  const members = [{ id: 'writer' }, { id: 'designer' }];
  it('routes unique current-group members in selection order', () => {
    const policy = createGroupMentionPolicy(
      '<mention name="Writer" id="writer" /> <mention id="designer" /> <mention id="writer" />',
      members,
      'host',
    );
    expect(policy?.steps.map((step) => JSON.parse(step.arguments).agentId)).toEqual([
      'writer',
      'designer',
    ]);
  });
  it('does not mistake a data attribute for a member identifier', () => {
    expect(
      createGroupMentionPolicy('<mention data-id="writer" />', members, 'host'),
    ).toBeUndefined();
  });
  it('rejects a foreign or removed member', () => {
    expect(() => createGroupMentionPolicy('<mention id="foreign" />', members, 'host')).toThrow();
  });
  it('lets the supervisor answer normally without delegation', () => {
    expect(createGroupMentionPolicy('<mention id="host" />', members, 'host')).toBeUndefined();
    expect(createGroupMentionPolicy('hello', members, 'host')).toBeUndefined();
  });
});
