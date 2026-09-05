import { createHash } from 'node:crypto';

import { serverDB } from '@lobechat/database';
import { toNextJsHandler } from 'better-auth/next-js';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { auth } from '@/auth';
import { RbacModel } from '@/database/models/rbac';
import { users } from '@/database/schemas/user';
import { appEnv } from '@/envs/app';
import { checkAuthAbuseLimit } from '@/libs/better-auth/auth-abuse-control';
import { getActiveSession } from '@/libs/better-auth/getActiveSession';

const jsonContentTypeRegex = /^application\/(?:[a-z0-9.+-]*\+)?json/i;

const handler = toNextJsHandler(auth);

const originProtectedWriteSuffixes = new Set([
  '/change-email',
  '/change-password',
  '/delete-user',
  '/email-otp/change-email',
  '/email-otp/check-verification-otp',
  '/email-otp/request-email-change',
  '/email-otp/request-password-reset',
  '/email-otp/reset-password',
  '/email-otp/send-verification-otp',
  '/email-otp/verify-email',
  '/forget-password/email-otp',
  '/phone-number/request-password-reset',
  '/phone-number/reset-password',
  '/phone-number/send-otp',
  '/phone-number/verify',
  '/request-password-reset',
  '/reset-password',
  '/revoke-other-sessions',
  '/revoke-sessions',
  '/send-verification-email',
  '/sign-in/email',
  '/sign-in/email-otp',
  '/sign-in/magic-link',
  '/sign-in/phone-number',
  '/sign-out',
  '/sign-up/email',
]);

const otpVerificationSuffixes = [
  '/email-otp/change-email',
  '/email-otp/check-verification-otp',
  '/email-otp/reset-password',
  '/email-otp/verify-email',
  '/sign-in/email-otp',
  '/phone-number/reset-password',
  '/phone-number/verify',
];
const otpFailureCodes = new Set([
  'INVALID_OTP',
  'OTP_EXPIRED',
  'TOO_MANY_ATTEMPTS',
  'USER_NOT_FOUND',
]);

const malformedJsonResponse = () =>
  Response.json({ code: 'INVALID_JSON', message: 'Malformed JSON request body' }, { status: 400 });

const usernameIdentifierRegex = /^\w+$/;

const privatePasswordResetEmail = (username: string) =>
  `username-${createHash('sha256').update(username).digest('hex')}@invalid.example`;

const isUserManagementRequest = (request: Request) =>
  new URL(request.url).pathname.includes('/api/auth/admin/');

const isSessionReadRequest = (request: Request) =>
  new URL(request.url).pathname.endsWith('/api/auth/get-session');

const rejectUntrustedWriteOrigin = (request: Request): Response | undefined => {
  const pathname = new URL(request.url).pathname;
  if (
    ![...originProtectedWriteSuffixes].some((suffix) => pathname.endsWith(`/api/auth${suffix}`))
  ) {
    return;
  }

  const origin = request.headers.get('origin');
  // Native/mobile clients may omit Origin. Browser requests include it, and an explicitly
  // supplied Origin must match the single public application origin.
  if (!origin || origin === new URL(appEnv.APP_URL).origin) return;

  return Response.json(
    { code: 'INVALID_ORIGIN', message: 'Invalid request origin' },
    { status: 403 },
  );
};

const requireUserManagementAdmin = async (request: Request): Promise<Response | undefined> => {
  if (!isUserManagementRequest(request)) return;

  const session = await getActiveSession(request.headers, serverDB);
  if (!session?.user.id) {
    return Response.json({ code: 'UNAUTHORIZED', message: 'Sign in required' }, { status: 401 });
  }

  const isPlatformAdmin = await new RbacModel(serverDB, session.user.id).hasGlobalRole(
    'super_admin',
  );
  if (!isPlatformAdmin) {
    return Response.json(
      { code: 'FORBIDDEN', message: 'Platform administrator access is required' },
      { status: 403 },
    );
  }
};

/**
 * better-call currently treats Request.json() SyntaxError as a server error.
 * Validate JSON bodies at the route boundary so malformed client payloads stay 400s.
 */
const validateJsonBody = async (request: Request) => {
  const contentType = request.headers.get('content-type') || '';
  if (!request.body || !jsonContentTypeRegex.test(contentType)) return;

  try {
    await request.clone().json();
  } catch (error) {
    if (error instanceof SyntaxError) return malformedJsonResponse();
    throw error;
  }
};

const hardenPasswordChangeRequest = async (request: NextRequest): Promise<NextRequest> => {
  const pathname = new URL(request.url).pathname;
  const contentType = request.headers.get('content-type') || '';
  if (
    !pathname.endsWith('/api/auth/change-password') ||
    !request.body ||
    !jsonContentTypeRegex.test(contentType)
  ) {
    return request;
  }

  const body = await request.clone().json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) return request;

  return new Request(request, {
    body: JSON.stringify({ ...body, revokeOtherSessions: true }),
    method: 'POST',
  }) as NextRequest;
};

const resolvePasswordResetUsername = async (request: NextRequest): Promise<NextRequest> => {
  const pathname = new URL(request.url).pathname;
  const contentType = request.headers.get('content-type') || '';
  if (
    !pathname.endsWith('/api/auth/request-password-reset') ||
    !request.body ||
    !jsonContentTypeRegex.test(contentType)
  ) {
    return request;
  }

  const body = await request.clone().json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) return request;

  const identifier = typeof body.email === 'string' ? body.email.trim() : '';
  if (!identifier || identifier.includes('@')) return request;

  const user =
    identifier.length <= 255 && usernameIdentifierRegex.test(identifier)
      ? await serverDB.query.users.findFirst({
          columns: { email: true },
          where: eq(users.username, identifier),
        })
      : undefined;

  return new Request(request, {
    body: JSON.stringify({
      ...body,
      email: user?.email || privatePasswordResetEmail(identifier),
    }),
    method: 'POST',
  }) as NextRequest;
};

const normalizeOtpFailureResponse = async (request: Request, response: Response) => {
  const pathname = new URL(request.url).pathname;
  if (!otpVerificationSuffixes.some((suffix) => pathname.endsWith(`/api/auth${suffix}`))) {
    return response;
  }

  let code: unknown;
  try {
    const body = await response.clone().json();
    code = body?.code;
  } catch {
    return response;
  }
  if (typeof code !== 'string' || !otpFailureCodes.has(code)) return response;

  return Response.json(
    { code: 'INVALID_OTP', message: 'Invalid or expired verification code' },
    { status: 400 },
  );
};

const abuseResponse = (decision: Awaited<ReturnType<typeof checkAuthAbuseLimit>>) => {
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

export const GET = async (request: NextRequest) => {
  const limitedResponse = abuseResponse(await checkAuthAbuseLimit(request));
  if (limitedResponse) return limitedResponse;

  if (isSessionReadRequest(request)) {
    const session = await getActiveSession(request.headers, serverDB);
    if (!session) return Response.json(null);
  }

  const deniedResponse = await requireUserManagementAdmin(request);
  if (deniedResponse) return deniedResponse;

  return handler.GET(request);
};

export const POST = async (request: NextRequest) => {
  const invalidOriginResponse = rejectUntrustedWriteOrigin(request);
  if (invalidOriginResponse) return invalidOriginResponse;

  const abuseDecision = await checkAuthAbuseLimit(request);
  const limitedResponse = abuseResponse(abuseDecision);
  if (limitedResponse) return limitedResponse;

  const deniedResponse = await requireUserManagementAdmin(request);
  if (deniedResponse) return deniedResponse;

  const invalidJsonResponse = await validateJsonBody(request);
  if (invalidJsonResponse) return invalidJsonResponse;

  const passwordResetRequest = await resolvePasswordResetUsername(request);
  const hardenedRequest = await hardenPasswordChangeRequest(passwordResetRequest);
  return normalizeOtpFailureResponse(hardenedRequest, await handler.POST(hardenedRequest));
};
