import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { guardAuthLookupRequest } from './authLookupGuard';

export interface CheckUserResponseData {
  canAttemptSignIn: true;
}

/**
 * Retained for older clients, but deliberately does not reveal account state.
 * @param req - POST request with { email: string }
 * @returns the same continuation response for every syntactically valid email
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { code: 'INVALID_REQUEST', message: 'Email is required' },
        { status: 400 },
      );
    }

    const deniedResponse = await guardAuthLookupRequest(req, email.toLowerCase().trim());
    if (deniedResponse) return deniedResponse;

    return NextResponse.json({ canAttemptSignIn: true } satisfies CheckUserResponseData);
  } catch (error) {
    console.error('Error validating sign-in continuation:', error);
    return NextResponse.json(
      { code: 'AUTH_TEMPORARILY_UNAVAILABLE', message: 'Please try again later' },
      { status: 503 },
    );
  }
}
