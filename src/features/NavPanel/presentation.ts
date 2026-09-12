const COMPACT_NAV_KEYS = new Set([
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
]);

export const supportsCompactNavRail = (navKey: string): boolean => COMPACT_NAV_KEYS.has(navKey);

interface ResolveNavPanelPresentationParams {
  supportsCompactRail: boolean;
  userExpanded: boolean;
  viewportAllowsExpanded: boolean | undefined;
}

export const resolveNavPanelPresentation = ({
  supportsCompactRail,
  userExpanded,
  viewportAllowsExpanded,
}: ResolveNavPanelPresentationParams) => {
  const automaticCompact = viewportAllowsExpanded === false && supportsCompactRail;

  return {
    automaticCompact,
    compact: supportsCompactRail && (!userExpanded || automaticCompact),
  };
};
