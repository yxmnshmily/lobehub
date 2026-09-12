import { describe, expect, it } from 'vitest';

import { resolveNavPanelPresentation, supportsCompactNavRail } from './presentation';

describe('supportsCompactNavRail', () => {
  it.each([
    'home',
    'agent',
    'group',
    'image',
    'video',
    'resource',
    'settings',
    'memory',
    'discover',
    'tasks',
    'data-center',
    'apps',
    'workspace-settings',
    'project',
    'resourceLibrary',
    'agent-docs',
    'eval',
    'evalBench',
  ])('supports the shared rail for %s', (navKey) => {
    expect(supportsCompactNavRail(navKey)).toBe(true);
  });

  it('leaves non-icon custom panels unchanged', () => {
    expect(supportsCompactNavRail('custom-panel')).toBe(false);
  });
});

describe('resolveNavPanelPresentation', () => {
  it('temporarily compacts an expanded panel when the viewport is below lg', () => {
    expect(
      resolveNavPanelPresentation({
        supportsCompactRail: true,
        userExpanded: true,
        viewportAllowsExpanded: false,
      }),
    ).toEqual({ automaticCompact: true, compact: true });
  });

  it('restores the user preference when the viewport becomes wide again', () => {
    expect(
      resolveNavPanelPresentation({
        supportsCompactRail: true,
        userExpanded: true,
        viewportAllowsExpanded: true,
      }),
    ).toEqual({ automaticCompact: false, compact: false });
  });

  it('keeps the saved presentation until the responsive breakpoint is measured', () => {
    expect(
      resolveNavPanelPresentation({
        supportsCompactRail: true,
        userExpanded: true,
        viewportAllowsExpanded: undefined,
      }),
    ).toEqual({ automaticCompact: false, compact: false });
  });

  it('keeps a user-collapsed icon panel compact on wide screens', () => {
    expect(
      resolveNavPanelPresentation({
        supportsCompactRail: true,
        userExpanded: false,
        viewportAllowsExpanded: true,
      }),
    ).toEqual({ automaticCompact: false, compact: true });
  });

  it('does not invent a rail for a custom non-icon panel', () => {
    expect(
      resolveNavPanelPresentation({
        supportsCompactRail: false,
        userExpanded: true,
        viewportAllowsExpanded: false,
      }),
    ).toEqual({ automaticCompact: false, compact: false });
  });
});
