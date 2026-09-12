import { createHash, timingSafeEqual } from 'node:crypto';

import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  verifyEmail as betterAuthVerifyEmail,
} from 'better-auth/api';
import type { BetterAuthPlugin } from 'better-auth/types';
import { jwtVerify } from 'jose';

const IDENTIFIER_PREFIX = 'travel-email-verification';
const INVALID_TOKEN_RECOVERY_PATH = '/lobehub/verify-email?error=INVALID_VERIFICATION_TOKEN';

interface VerificationRecord {
  expiresAt: Date;
  value: string;
}

interface VerificationTokenAdapter {
  consumeVerificationValue: (identifier: string) => Promise<null | VerificationRecord>;
  createVerificationValue: (data: {
    expiresAt: Date;
    identifier: string;
    value: string;
  }) => Promise<unknown>;
  deleteVerificationByIdentifier: (identifier: string) => Promise<unknown>;
  findVerificationValue: (identifier: string) => Promise<null | VerificationRecord>;
  updateVerificationByIdentifier: (
    identifier: string,
    data: { expiresAt: Date; value: string },
  ) => Promise<unknown>;
}

export interface PreparedEmailVerificationToken {
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
}

const fingerprint = (value: string): string =>
  createHash('sha256').update(value).digest('base64url');

const matchesFingerprint = (left: string, right: string): boolean => {
  const leftBuffer = new TextEncoder().encode(left);
  const rightBuffer = new TextEncoder().encode(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const latestIdentifier = (email: string): string =>
  `${IDENTIFIER_PREFIX}:latest:${fingerprint(email.toLowerCase())}`;

const tokenIdentifier = (tokenFingerprint: string): string =>
  `${IDENTIFIER_PREFIX}:token:${tokenFingerprint}`;

const reservationIdentifier = (tokenFingerprint: string): string =>
  `${IDENTIFIER_PREFIX}:reservation:${tokenFingerprint}`;

const rejectVerificationToken = (): never => {
  throw new APIError('UNAUTHORIZED', {
    code: 'INVALID_VERIFICATION_TOKEN',
    message: 'Invalid or expired verification token',
  });
};

const hasAllowedMountedCallback = (callback: unknown, baseURL: string): boolean => {
  if (callback === undefined) return true;
  if (typeof callback !== 'string' || callback.includes('\\')) return false;

  try {
    const configuredOrigin = new URL(baseURL).origin;
    const parsed = new URL(callback, configuredOrigin);
    return (
      parsed.origin === configuredOrigin &&
      !parsed.pathname.includes('%') &&
      (parsed.pathname === '/lobehub' || parsed.pathname.startsWith('/lobehub/'))
    );
  } catch {
    return false;
  }
};

export const prepareEmailVerificationToken = async (
  adapter: VerificationTokenAdapter,
  { email, expiresInSeconds, token }: { email: string; expiresInSeconds: number; token: string },
): Promise<PreparedEmailVerificationToken> => {
  const normalizedEmail = email.toLowerCase();
  const nextFingerprint = fingerprint(token);
  const pointerIdentifier = latestIdentifier(normalizedEmail);
  const previous = await adapter.findVerificationValue(pointerIdentifier);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  await adapter.createVerificationValue({
    expiresAt,
    identifier: tokenIdentifier(nextFingerprint),
    value: fingerprint(normalizedEmail),
  });

  let state: 'committed' | 'prepared' | 'rolled-back' = 'prepared';

  return {
    commit: async () => {
      if (state === 'committed') return;
      if (state === 'rolled-back')
        throw new Error('Verification token preparation was rolled back');

      const current = await adapter.findVerificationValue(pointerIdentifier);
      if (previous) {
        if (!current || !matchesFingerprint(current.value, previous.value)) {
          throw new Error('Verification token rotation was superseded');
        }
        await adapter.updateVerificationByIdentifier(pointerIdentifier, {
          expiresAt,
          value: nextFingerprint,
        });
      } else if (!current) {
        await adapter.createVerificationValue({
          expiresAt,
          identifier: pointerIdentifier,
          value: nextFingerprint,
        });
      } else if (!matchesFingerprint(current.value, nextFingerprint)) {
        throw new Error('Verification token rotation was superseded');
      }

      state = 'committed';
      if (previous?.value && !matchesFingerprint(previous.value, nextFingerprint)) {
        await adapter.deleteVerificationByIdentifier(tokenIdentifier(previous.value));
      }
    },
    rollback: async () => {
      if (state !== 'prepared') return;

      const current = await adapter.findVerificationValue(pointerIdentifier);
      if (!current || !matchesFingerprint(current.value, nextFingerprint)) {
        await adapter.deleteVerificationByIdentifier(tokenIdentifier(nextFingerprint));
      }
      state = 'rolled-back';
    },
  };
};

export const registerEmailVerificationToken = async (
  adapter: VerificationTokenAdapter,
  input: { email: string; expiresInSeconds: number; token: string },
): Promise<void> => {
  const prepared = await prepareEmailVerificationToken(adapter, input);

  try {
    await prepared.commit();
  } catch (error) {
    try {
      await prepared.rollback();
    } catch {
      // Preserve the commit error; an unreferenced prepared row expires naturally.
    }
    throw error;
  }
};

const verificationRecipient = (payload: unknown, reject = rejectVerificationToken): string => {
  if (!payload || typeof payload !== 'object') return reject();
  const claims = payload as { email?: unknown; requestType?: unknown; updateTo?: unknown };
  if (typeof claims.email !== 'string') return reject();
  if (claims.requestType !== 'change-email-confirmation' && typeof claims.updateTo === 'string') {
    return claims.updateTo.toLowerCase();
  }

  return claims.email.toLowerCase();
};

interface VerificationReservation {
  adapter: VerificationTokenAdapter;
  emailFingerprint: string;
  expiresAt: Date;
  pointerIdentifier: string;
  reservationIdentifier: string;
  tokenFingerprint: string;
  tokenIdentifier: string;
}

const isExpectedCallbackRedirect = (
  error: unknown,
  baseURL: string,
  callbackURL: unknown,
): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { headers?: HeadersInit; statusCode?: unknown };
  if (
    typeof candidate.statusCode !== 'number' ||
    candidate.statusCode < 300 ||
    candidate.statusCode >= 400 ||
    typeof callbackURL !== 'string'
  ) {
    return false;
  }
  const location = new Headers(candidate.headers).get('location');
  if (!location) return false;

  try {
    return new URL(location, baseURL).href === new URL(callbackURL, baseURL).href;
  } catch {
    return false;
  }
};

const restoreReservation = async (reservation: VerificationReservation): Promise<void> => {
  const latest = await reservation.adapter.findVerificationValue(reservation.pointerIdentifier);
  if (
    latest &&
    matchesFingerprint(latest.value, reservation.tokenFingerprint) &&
    reservation.expiresAt.getTime() > Date.now()
  ) {
    const currentToken = await reservation.adapter.findVerificationValue(
      reservation.tokenIdentifier,
    );
    if (!currentToken) {
      await reservation.adapter.createVerificationValue({
        expiresAt: reservation.expiresAt,
        identifier: reservation.tokenIdentifier,
        value: reservation.emailFingerprint,
      });
    }
  }
  await reservation.adapter.deleteVerificationByIdentifier(reservation.reservationIdentifier);
};

export const oneTimeEmailVerificationToken = (): BetterAuthPlugin => {
  const pendingReservations = new Map<string, VerificationReservation>();
  const verifyEmail = createAuthEndpoint(
    betterAuthVerifyEmail.path,
    betterAuthVerifyEmail.options,
    async (context) => {
      const token = context.query?.token;
      const tokenFingerprint = typeof token === 'string' ? fingerprint(token) : undefined;
      const reservation = tokenFingerprint ? pendingReservations.get(tokenFingerprint) : undefined;
      if (!reservation) return rejectVerificationToken();

      let settled = false;
      try {
        const result = await betterAuthVerifyEmail({
          ...context,
          asResponse: false,
          returnHeaders: true,
        });
        result.headers?.forEach((value, key) => context.setHeader(key, value));
        await reservation.adapter.deleteVerificationByIdentifier(reservation.reservationIdentifier);
        settled = true;
        return result.response;
      } catch (error) {
        if (!settled) {
          if (
            isExpectedCallbackRedirect(error, context.context.baseURL, context.query?.callbackURL)
          ) {
            await reservation.adapter.deleteVerificationByIdentifier(
              reservation.reservationIdentifier,
            );
          } else {
            await restoreReservation(reservation);
          }
        }
        throw error;
      } finally {
        pendingReservations.delete(reservation.tokenFingerprint);
      }
    },
  );

  return {
    endpoints: { verifyEmail },
    hooks: {
      before: [
        {
          handler: createAuthMiddleware(async (context) => {
            const callbackURL = context.query?.callbackURL;
            if (!hasAllowedMountedCallback(callbackURL, context.context.baseURL)) {
              return rejectVerificationToken();
            }
            const reject = (): never => {
              if (typeof callbackURL === 'string') {
                throw context.redirect(INVALID_TOKEN_RECOVERY_PATH);
              }
              return rejectVerificationToken();
            };

            const token = context.query?.token;
            if (typeof token !== 'string') return reject();

            let payload: unknown;
            try {
              const verified = await jwtVerify(
                token,
                new TextEncoder().encode(context.context.secret),
                { algorithms: ['HS256'] },
              );
              payload = verified.payload;
            } catch {
              return reject();
            }
            const recipient = verificationRecipient(payload, reject);

            const tokenFingerprint = fingerprint(token);
            const pointerIdentifier = latestIdentifier(recipient);
            const expectedEmailFingerprint = fingerprint(recipient);
            const latest =
              await context.context.internalAdapter.findVerificationValue(pointerIdentifier);
            if (!latest || !matchesFingerprint(latest.value, tokenFingerprint)) {
              return reject();
            }

            const currentTokenIdentifier = tokenIdentifier(tokenFingerprint);
            const consumed =
              await context.context.internalAdapter.consumeVerificationValue(
                currentTokenIdentifier,
              );
            if (!consumed || !matchesFingerprint(consumed.value, expectedEmailFingerprint)) {
              return reject();
            }

            const currentLatest =
              await context.context.internalAdapter.findVerificationValue(pointerIdentifier);
            if (!currentLatest || !matchesFingerprint(currentLatest.value, tokenFingerprint)) {
              return reject();
            }

            const currentReservationIdentifier = reservationIdentifier(tokenFingerprint);
            const reservation: VerificationReservation = {
              adapter: context.context.internalAdapter,
              emailFingerprint: consumed.value,
              expiresAt: consumed.expiresAt,
              pointerIdentifier,
              reservationIdentifier: currentReservationIdentifier,
              tokenFingerprint,
              tokenIdentifier: currentTokenIdentifier,
            };

            try {
              await context.context.internalAdapter.createVerificationValue({
                expiresAt: consumed.expiresAt,
                identifier: currentReservationIdentifier,
                value: consumed.value,
              });
            } catch (error) {
              await restoreReservation(reservation);
              throw error;
            }

            pendingReservations.set(tokenFingerprint, reservation);
          }),
          matcher: (context) => context.path === '/verify-email',
        },
      ],
    },
    id: 'one-time-email-verification-token',
  };
};
