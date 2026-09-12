export type PlatformAdminRouteAccess = 'allow' | 'loading' | 'redirect';

export const CUSTOMER_SETTINGS_TAB_PATHS = [
  'profile',
  'security',
  'plans',
  'usage',
  'credits',
  'billing',
] as const;

export const PLATFORM_SETTINGS_TAB_PATHS = [
  'apikey',
  'credential',
  'oauth-apps',
  'service-operations',
  'content-moderation',
  'service-model',
  'skill',
] as const;

export const resolvePlatformAdminRouteAccess = ({
  isLoading,
  isPlatformAdmin,
}: {
  isLoading: boolean;
  isPlatformAdmin?: boolean;
}): PlatformAdminRouteAccess => {
  if (isLoading) return 'loading';
  return isPlatformAdmin ? 'allow' : 'redirect';
};

const CUSTOMER_MAIN_PATHS = [
  /^\/$/,
  /^\/settings\/(?:profile|security|credits|billing)(?:\/[^/]+)?\/?$/,
  /^\/settings\/plans\/?$/,
  /^\/settings\/usage\/?$/,
  /^\/settings\/works\/?$/,
  /^\/page\/?$/,
  /^\/page\/[^/]+\/?$/,
  /^\/(?:image|video)\/?$/,
  /^\/memory(?:\/.*)?$/,
  /^\/me\/?$/,
  /^\/me\/(?:profile|settings)\/?$/,
  // Embedded project pages keep the project's existing server-side resource authorization.
  /^\/group\/[^/]+\/project\/[^/]+(?:\/(?:conversation(?:\/[^/]+)?|tasks|goals|acceptance(?:\/[^/]+(?:\/check\/[^/]+)?)?|(?:task|goal)\/[^/]+))?\/?$/,
];

const GROUP_MANAGEMENT_SEGMENTS = new Set([
  'member-management',
  'members',
  'permission',
  'settings',
]);

/**
 * Ordinary customers may use their own group conversation and topic routes,
 * including the read-only default-group profile. Its local editor retains
 * its own administrator gate; other configuration routes remain restricted.
 * Ownership and private-group isolation are still enforced by the server.
 */
const isCustomerGroupChatPath = (pathname: string): boolean => {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] !== 'group' || (segments.length !== 2 && segments.length !== 3)) return false;
  if (segments.length === 2) return true;

  return !GROUP_MANAGEMENT_SEGMENTS.has(segments[2]);
};

export const isCustomerMainRoutePath = (pathname: string, search = ''): boolean => {
  if (/^\/settings\/?$/.test(pathname)) {
    const activeTab = new URLSearchParams(search).get('active');
    if (!activeTab) return true;

    return CUSTOMER_SETTINGS_TAB_PATHS.includes(
      activeTab as (typeof CUSTOMER_SETTINGS_TAB_PATHS)[number],
    );
  }

  return (
    CUSTOMER_MAIN_PATHS.some((pattern) => pattern.test(pathname)) ||
    isCustomerGroupChatPath(pathname)
  );
};

export const resolveCustomerMainRouteAccess = ({
  isLoading,
  isPlatformAdmin,
  pathname,
  search = '',
}: {
  isLoading: boolean;
  isPlatformAdmin?: boolean;
  pathname: string;
  search?: string;
}): PlatformAdminRouteAccess => {
  // Customer routes do not depend on platform-admin status. Their existing
  // authentication and resource-level authorization remain in place.
  if (isCustomerMainRoutePath(pathname, search)) return 'allow';
  if (isLoading) return 'loading';
  return isPlatformAdmin ? 'allow' : 'redirect';
};
