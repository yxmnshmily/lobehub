import { describe, expect, it } from 'vitest';

import { belongsToWorkGroup, scopeGroupWorkPath } from './GroupWorkScope';

describe('group work navigation', () => {
  it('rejects unscoped and other-group records even when they have the same executor', () => {
    expect(belongsToWorkGroup({ groupId: 'travel' }, 'travel')).toBe(true);
    for (const config of [undefined, null, {}, { groupId: 'other' }, 'travel'])
      expect(belongsToWorkGroup(config, 'travel')).toBe(false);
  });
  it.each([
    ['/agent/a/goal/g1', '/group/travel/goal/g1'],
    ['/agent/b/task/T-4?run=1#reply', '/group/travel/task/T-4?run=1#reply'],
    ['/task/T-5', '/group/travel/task/T-5'],
    ['/goals', '/group/travel/goals'],
    ['/agent/a/tasks', '/group/travel/tasks'],
  ])('keeps %s inside the work group', (path, expected) => {
    expect(scopeGroupWorkPath(path, { groupId: 'travel' })).toBe(expected);
  });

  it('does not change standalone, project, member configuration or other group links', () => {
    expect(scopeGroupWorkPath('/task/T-1')).toBe('/task/T-1');
    for (const path of ['/project/p/tasks', '/agent/a/profile', '/group/other/task/T-1'])
      expect(scopeGroupWorkPath(path, { groupId: 'travel' })).toBe(path);
  });
});
