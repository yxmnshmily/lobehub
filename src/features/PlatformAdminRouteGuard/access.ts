export type PlatformAdminRouteAccess = 'allow' | 'loading' | 'redirect';

export const CUSTOMER_SETTINGS_TAB_PATHS = ['profile', 'security', 'credits', 'billing'] as const;

export const PLATFORM_SETTINGS_TAB_PATHS = [
  'apikey',
  'credential',
  'oauth-apps',
  'service-operations',
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
  /^\/settings\/works\/?$/,
  /^\/page\/?$/,
  /^\/page\/[^/]+\/?$/,
  /^\/(?:image|video)\/?$/,
  /^\/me\/?$/,
  /^\/me\/(?:profile|settings)\/?$/,
];

const GROUP_MANAGEMENT_SEGMENTS = new Set([
  'member-management',
  'members',
  'permission',
  'profile',
  'settings',
]);

/**
 * Ordinary customers may use their own group conversation and topic routes,
 * while every group configuration surface remains platform-admin-only.
 * Ownership and private-group isolation are still enforced by the server.
 */
const isCustomerGroupChatPath = (pathname: string): boolean => {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] !== 'group' || (segments.length !== 2 && segments.length !== 3)) return false;
  if (segments.length === 2) return true;

  return !GROUP_MANAGEMENT_SEGMENTS.has(segments[2]);
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
  if (isLoading) return 'loading';
  if (isPlatformAdmin) return 'allow';

  if (/^\/settings\/?$/.test(pathname)) {
    const activeTab = new URLSearchParams(search).get('active');
    if (!activeTab) return 'allow';

    return CUSTOMER_SETTINGS_TAB_PATHS.includes(
      activeTab as (typeof CUSTOMER_SETTINGS_TAB_PATHS)[number],
    )
      ? 'allow'
      : 'redirect';
  }

  return CUSTOMER_MAIN_PATHS.some((pattern) => pattern.test(pathname)) ||
    isCustomerGroupChatPath(pathname)
    ? 'allow'
    : 'redirect';
};
