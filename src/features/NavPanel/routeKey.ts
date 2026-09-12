export const resolveNavPanelKey = (
  pathname: string,
  activeWorkspaceSlug: string | null,
): string => {
  const segments = pathname.split('/').filter(Boolean);
  const isWorkspaceRoute =
    !!activeWorkspaceSlug && segments.length > 0 && segments[0] === activeWorkspaceSlug;
  const routeSegments = isWorkspaceRoute ? segments.slice(1) : segments;
  const [rootSegment, childSegment, grandchildSegment] = routeSegments;

  if (!isWorkspaceRoute && rootSegment === 'settings' && childSegment === 'stats') {
    return 'data-center';
  }

  if (rootSegment === 'settings') {
    return isWorkspaceRoute ? 'workspace-settings' : 'settings';
  }

  switch (rootSegment) {
    case 'apps': {
      return 'apps';
    }

    case 'task':
    case 'tasks': {
      return isWorkspaceRoute ? 'home' : 'tasks';
    }

    case 'agent': {
      return grandchildSegment === 'docs' ? 'agent-docs' : 'agent';
    }

    case 'community': {
      return 'discover';
    }

    case 'eval': {
      return childSegment === 'bench' ? 'evalBench' : 'eval';
    }

    case 'group': {
      return 'group';
    }

    case 'image': {
      return 'image';
    }

    case 'memory': {
      return 'memory';
    }

    case 'page': {
      return 'image';
    }

    case 'project': {
      return 'project';
    }

    case 'resource': {
      return childSegment === 'library' ? 'resourceLibrary' : 'resource';
    }

    case 'video': {
      return 'video';
    }

    default: {
      return 'home';
    }
  }
};
