import { describe, expect, it } from 'vitest';

import { scopeProjectPath } from './GroupProjectScope';

describe('embedded project navigation', () => {
  const scope = { groupId: 'g1', projectId: 'p1' };
  it('keeps project switches and its task/goal/acceptance pages in the group pane', () => {
    expect(scopeProjectPath('/project/p1/conversation/topic-1', scope)).toBe(
      '/group/g1/project/p1/conversation/topic-1',
    );
    expect(scopeProjectPath('/project/p2/tasks?view=cron', scope)).toBe(
      '/group/g1/project/p2/tasks?view=cron',
    );
    expect(scopeProjectPath('/project/p1/goals', scope)).toBe('/group/g1/project/p1/goals');
    expect(scopeProjectPath('/acceptance/a1#evidence', scope)).toBe(
      '/group/g1/project/p1/acceptance/a1#evidence',
    );
    expect(scopeProjectPath('/agent/a1/task/T-1', scope)).toBe('/group/g1/project/p1/task/T-1');
    expect(scopeProjectPath('/goal/goal1', scope)).toBe('/group/g1/project/p1/goal/goal1');
  });
  it('does not intercept unrelated destinations, already scoped URLs, or standalone project use', () => {
    expect(scopeProjectPath('/project/p1/tasks')).toBe('/project/p1/tasks');
    expect(scopeProjectPath('/settings/profile', scope)).toBe('/settings/profile');
    expect(scopeProjectPath('/group/g2', scope)).toBe('/group/g2');
    expect(scopeProjectPath('/group/g1/project/p1/tasks', scope)).toBe(
      '/group/g1/project/p1/tasks',
    );
    expect(scopeProjectPath('https://example.com/project/p1', scope)).toBe(
      'https://example.com/project/p1',
    );
  });
});
