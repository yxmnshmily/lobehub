import { describe, expect, it } from 'vitest';

import { getTaskDetailPageUrl } from './url';

describe('getTaskDetailPageUrl', () => {
  it('keeps group tasks in their work group even when an executor is assigned', () => {
    expect(
      getTaskDetailPageUrl({
        agentId: 'executor',
        appOrigin: 'https://app.example.com',
        groupId: 'travel',
        taskId: 'T-245',
        workspaceSlug: 'lobehub',
      }),
    ).toBe('https://app.example.com/lobehub/group/travel/task/T-245');
  });
  it('builds a workspace-aware agent task URL', () => {
    expect(
      getTaskDetailPageUrl({
        agentId: 'agt-owner',
        appOrigin: 'https://app.example.com',
        taskId: 'T-245',
        workspaceSlug: 'lobehub',
      }),
    ).toBe('https://app.example.com/lobehub/agent/agt-owner/task/T-245');
  });

  it('falls back to the unscoped task route without an agent', () => {
    expect(getTaskDetailPageUrl({ appOrigin: 'https://app.example.com', taskId: 'T-245' })).toBe(
      'https://app.example.com/task/T-245',
    );
  });

  it('returns undefined without a resolvable absolute URL', () => {
    expect(getTaskDetailPageUrl({ appOrigin: 'https://app.example.com' })).toBeUndefined();
    expect(getTaskDetailPageUrl({ taskId: 'T-245' })).toBeUndefined();
  });
});
