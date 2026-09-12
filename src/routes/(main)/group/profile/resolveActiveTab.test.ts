import { describe, expect, it } from 'vitest';

import {
  resolveActiveTab,
  resolveGroupProfileRedirect,
  resolveMemberProfileRedirect,
} from './resolveActiveTab';

describe('resolveMemberProfileRedirect', () => {
  it('routes members to their standalone profile without redirecting group or invalid tabs', () => {
    expect(resolveMemberProfileRedirect('agent-1', ['agent-1'])).toBe('/agent/agent-1/profile');
    expect(resolveMemberProfileRedirect('group', ['agent-1'])).toBeUndefined();
    expect(resolveMemberProfileRedirect('other', ['agent-1'])).toBeUndefined();
    expect(resolveMemberProfileRedirect('agent-1', [])).toBeUndefined();
  });
});

describe('resolveActiveTab', () => {
  it('falls back to group settings when a member tab belongs to another group', () => {
    expect(resolveActiveTab('agent-from-group-a', ['agent-from-group-b'])).toBe('group');
    expect(resolveActiveTab('agent-from-group-b', ['agent-from-group-b'])).toBe(
      'agent-from-group-b',
    );
  });
});

describe('resolveGroupProfileRedirect', () => {
  it('redirects only the personal default supergroup away from local profile editing', () => {
    expect(
      resolveGroupProfileRedirect(
        {
          clientId: 'default-travel-service-group',
          workspaceId: null,
        },
        'group-1',
      ),
    ).toBe('/group/group-1');
    expect(
      resolveGroupProfileRedirect(
        {
          clientId: 'default-travel-service-group',
          workspaceId: 'workspace-1',
        },
        'group-1',
      ),
    ).toBeUndefined();
    expect(
      resolveGroupProfileRedirect(
        {
          clientId: null,
          workspaceId: null,
        },
        'group-1',
      ),
    ).toBeUndefined();
  });
});
