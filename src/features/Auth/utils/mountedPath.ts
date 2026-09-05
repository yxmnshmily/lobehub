import { buildOnboardingRedirectUrl, sanitizeRedirectPath } from '@/utils/onboardingRedirect';

const LOBEHUB_MOUNT_PATH = '/lobehub';

const isMountedPath = (pathname: string): boolean =>
  pathname === LOBEHUB_MOUNT_PATH || pathname.startsWith(`${LOBEHUB_MOUNT_PATH}/`);

/** Keep server-generated auth redirects inside the public LobeHub mount when one is active. */
export const withLobeHubMountPath = (
  targetPath: string,
  currentPathname = typeof window === 'undefined' ? '' : window.location.pathname,
): string => {
  if (!isMountedPath(currentPathname) || isMountedPath(targetPath)) return targetPath;

  return `${LOBEHUB_MOUNT_PATH}${targetPath.startsWith('/') ? targetPath : `/${targetPath}`}`;
};

/** Whitelist a callback before it crosses the client/auth boundary and retain the active mount. */
export const resolveAuthCallbackPath = (
  callbackUrl: string | null | undefined,
  currentPathname = typeof window === 'undefined' ? '' : window.location.pathname,
): string => sanitizeRedirectPath(callbackUrl, withLobeHubMountPath('/', currentPathname));

/** Return verification links to a user-facing result page before continuing to the app. */
export const buildMountedEmailVerificationResultPath = (
  callbackUrl: string | null | undefined,
  email?: string,
  currentPathname = typeof window === 'undefined' ? '' : window.location.pathname,
): string => {
  const params = new URLSearchParams({
    callbackUrl: resolveAuthCallbackPath(callbackUrl, currentPathname),
    status: 'success',
  });
  if (email) params.set('email', email);

  return withLobeHubMountPath(`/verify-email?${params.toString()}`, currentPathname);
};

/** Build the first signup hop without treating the mounted app root as an extra callback. */
export const buildMountedOnboardingPath = (
  callbackUrl: string | null | undefined,
  currentPathname = typeof window === 'undefined' ? '' : window.location.pathname,
): string =>
  withLobeHubMountPath(
    buildOnboardingRedirectUrl(sanitizeRedirectPath(callbackUrl)),
    currentPathname,
  );
