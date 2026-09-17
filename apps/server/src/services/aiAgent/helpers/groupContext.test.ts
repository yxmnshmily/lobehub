import { formatGroupMembers } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

import { buildGroupAgentContext } from './groupContext';

describe('group member descriptions in runtime context', () => {
  it('passes the stored specialty through to the rendered member context', () => {
    const context = buildGroupAgentContext('writer', { title: 'Content' }, [
      {
        agentId: 'writer',
        description: '旅游文案与去 AI 味',
        role: 'participant',
        title: 'Writer',
      },
    ]);

    expect(context?.members?.[0]).toMatchObject({ description: '旅游文案与去 AI 味' });
    expect(formatGroupMembers(context!.members!)).toContain('description="旅游文案与去 AI 味"');
    expect(context?.currentAgentRole).toBe('participant');
  });

  it('does not invent capability data for an old roster without descriptions', () => {
    const context = buildGroupAgentContext('writer', undefined, [
      { agentId: 'writer', role: 'participant', title: null },
    ]);
    expect(formatGroupMembers(context!.members!)).toBe(
      '  <member name="Untitled Agent" id="writer" />',
    );
  });
});
