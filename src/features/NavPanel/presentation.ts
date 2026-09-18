const COMPACT_NAV_KEYS = new Set([
  'home',
  'agent',
  'group',
  'image',
  'video',
  /* 2026-09-18：补入 pages——page 栏目此前不在白名单，窄视口不折叠成图标栏，
     侧栏以展开形态堆叠，与 video/image 手机端不一致（用户反馈）。 */
  'pages',
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
