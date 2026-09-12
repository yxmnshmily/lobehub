import { createContext } from 'react';

export interface GroupProjectScope {
  groupId: string;
  projectId?: string;
}

/** Only provided around the project pane, never around the outer group navigation. */
export const GroupProjectScopeContext = createContext<GroupProjectScope | undefined>(undefined);

export const scopeProjectPath = (path: string, scope?: GroupProjectScope): string => {
  if (!scope) return path;
  const root = `/group/${encodeURIComponent(scope.groupId)}`;
  if (/^\/project(?:s(?:[?#]|$)|\/)/.test(path)) return `${root}${path}`;
  if (!scope.projectId) return path;
  const project = `${root}/project/${encodeURIComponent(scope.projectId)}`;
  if (/^\/(?:tasks|goals)(?:[?#]|$)/.test(path)) return `${project}${path}`;
  const detail = path.match(/^\/(?:agent\/[^/]+\/)?(task|goal)\/([^/?#]+)([?#].*)?$/);
  if (detail) return `${project}/${detail[1]}/${detail[2]}${detail[3] ?? ''}`;
  if (/^\/acceptance(?:[/?#]|$)/.test(path)) return `${project}${path}`;
  return path;
};
