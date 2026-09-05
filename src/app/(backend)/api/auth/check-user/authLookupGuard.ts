import { appEnv } from '@/envs/app';
import { checkAuthAbuseLimit } from '@/libs/better-auth/auth-abuse-control';

const rejectUntrustedOrigin = (request: Request): Response | undefined => {
  const origin = request.headers.get('origin');
  if (!origin || origin === new URL(appEnv.APP_URL).origin) return;

  return Response.json(
    { code: 'INVALID_ORIGIN', message: 'Invalid request origin' },
    { status: 403 },
  );
};

const abuseResponse = (
  decision: Awaited<ReturnType<typeof checkAuthAbuseLimit>>,
): Response | undefined => {
  if (decision.unavailable) {
    return Response.json(
      { code: 'AUTH_TEMPORARILY_UNAVAILABLE', message: 'Please try again later' },
      { status: 503 },
    );
  }
  if (decision.limited) {
    return Response.json(
      { code: 'TOO_MANY_REQUESTS', message: 'Please try again later' },
      { headers: { 'Retry-After': String(decision.retryAfter) }, status: 429 },
    );
  }
};

/**
 * Apply the same browser-origin and abuse-control contract as an email sign-in.
 * The legacy lookup endpoint uses the sign-in rule so it cannot become a cheaper
 * account-enumeration oracle than the actual credential submission endpoint.
 */
export const guardAuthLookupRequest = async (
  request: Request,
  accountIdentifier: string,
): Promise<Response | undefined> => {
  const invalidOrigin = rejectUntrustedOrigin(request);
  if (invalidOrigin) return invalidOrigin;

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  const rateLimitRequest = new Request(new URL('/api/auth/sign-in/email', request.url), {
    body: JSON.stringify({ email: accountIdentifier }),
    headers,
    method: 'POST',
  });

  return abuseResponse(await checkAuthAbuseLimit(rateLimitRequest));
};
