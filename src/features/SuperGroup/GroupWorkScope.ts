import { createContext } from 'react';

export interface GroupWorkScope {
  groupId: string;
}

/** Navigation identity only. Existing server authorization remains authoritative. */
export const GroupWorkScopeContext = createContext<GroupWorkScope | undefined>(undefined);
export const GroupWorkConversationContext = createContext<
  | {
      groupId: string;
      onTopicChange: (topicId: string | null) => void;
      topicId: string | null;
    }
  | undefined
>(undefined);

export const belongsToWorkGroup = (config: unknown, groupId: string): boolean =>
  !!config && typeof config === 'object' && 'groupId' in config && config.groupId === groupId;

export const scopeGroupWorkPath = (path: string, scope?: GroupWorkScope): string => {
  if (!scope) return path;
  const work = path.match(
    /^\/(?:agent\/[^/]+\/)?((?:tasks|goals)(?:[?#].*)?|(?:task|goal)\/[^/?#]+(?:[?#].*)?)$/,
  );
  return work ? `/group/${encodeURIComponent(scope.groupId)}/${work[1]}` : path;
};
