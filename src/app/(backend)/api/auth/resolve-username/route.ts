import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';
import { isSafeRedirectPath } from '@/utils/onboardingRedirect';

import { guardAuthLookupRequest } from '../check-user/authLookupGuard';

export interface ResolveUsernameResponseData {
  authenticated: true;
}

const credentialFailure = () =>
  NextResponse.json(
    { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
    { status: 401 },
  );

const privateLookupEmail = (username: string) =>
  `username-${createHash('sha256').update(username).digest('hex')}@invalid.example`;

const readResponseCode = async (response: Response): Promise<string | undefined> => {
  try {
    const body = await response.clone().json();
    return typeof body?.code === 'string' ? body.code : undefined;
  } catch {
    return;
  }
};

/**
 * Sign in by username without returning the account's email address to the browser.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { callbackURL, password, username } = body;

    if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
      return credentialFailure();
    }

    const normalizedUsername = username.trim();

    if (!normalizedUsername) {
      return credentialFailure();
    }

    const deniedResponse = await guardAuthLookupRequest(req, normalizedUsername);
    if (deniedResponse) return deniedResponse;

    const [user] = await serverDB
      .select({ email: users.email })
      .from(users)
      .where(eq(users.username, normalizedUsername))
      .limit(1);

    const email = user?.email || privateLookupEmail(normalizedUsername);
    const safeCallbackURL =
      typeof callbackURL === 'string' && isSafeRedirectPath(callbackURL) ? callbackURL : '/';
    const response = await auth.api.signInEmail({
      asResponse: true,
      body: {
        callbackURL: safeCallbackURL,
        email,
        password,
      },
      headers: req.headers,
    });

    if (!response.ok) {
      const responseCode = await readResponseCode(response);
      if (
        response.status === 429 ||
        response.status === 503 ||
        (response.status === 403 && responseCode === 'INVALID_ORIGIN')
      ) {
        return response;
      }
      return credentialFailure();
    }

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-length');
    responseHeaders.set('content-type', 'application/json');
    return NextResponse.json({ authenticated: true } satisfies ResolveUsernameResponseData, {
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Username sign-in failed:', error);
    return credentialFailure();
  }
}
