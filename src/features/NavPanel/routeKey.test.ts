import { describe, expect, it } from 'vitest';

import { resolveNavPanelKey } from './routeKey';

describe('resolveNavPanelKey', () => {
  it.each([
    ['/', null, 'home'],
    ['/home', null, 'home'],
    ['/agents', null, 'home'],
    ['/projects', null, 'home'],
    ['/goal/goal-1', null, 'home'],
    ['/apps', null, 'apps'],
    ['/lobe-team', 'lobe-team', 'home'],
    ['/tasks', null, 'tasks'],
    ['/task/task-1', null, 'tasks'],
    ['/lobe-team/tasks', 'lobe-team', 'home'],
    ['/lobe-team/task/task-1', 'lobe-team', 'home'],
    ['/agent/agent-1', null, 'agent'],
    ['/lobe-team/agent/agent-1', 'lobe-team', 'agent'],
    ['/agent/agent-1/docs', null, 'agent-docs'],
    ['/agent/agent-1/docs/docs-1', null, 'agent-docs'],
    ['/lobe-team/agent/agent-1/docs/docs-1', 'lobe-team', 'agent-docs'],
    ['/group/group-1', null, 'group'],
    ['/settings/profile', null, 'settings'],
    ['/settings/stats', null, 'data-center'],
    ['/lobe-team/settings/general', 'lobe-team', 'workspace-settings'],
    ['/lobe-team/community', 'lobe-team', 'discover'],
    ['/lobe-team/resource', 'lobe-team', 'resource'],
    ['/lobe-team/resource/library', 'lobe-team', 'resourceLibrary'],
    ['/lobe-team/memory', 'lobe-team', 'memory'],
    ['/lobe-team/eval', 'lobe-team', 'eval'],
    ['/lobe-team/eval/bench/benchmark-1', 'lobe-team', 'evalBench'],
    ['/page', null, 'pages'],
    ['/page/page-1', null, 'pages'],
    ['/lobe-team/page/page-1', 'lobe-team', 'pages'],
    ['/project/project-1', null, 'project'],
    ['/lobe-team/project/project-1/library/kb-1', 'lobe-team', 'project'],
    ['/lobe-team/image', 'lobe-team', 'image'],
    ['/lobe-team/video', 'lobe-team', 'video'],
  ])('maps %s to %s', (pathname, activeWorkspaceSlug, expected) => {
    expect(resolveNavPanelKey(pathname, activeWorkspaceSlug)).toBe(expected);
  });
});
