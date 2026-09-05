import { APIError } from 'better-auth/api';
import type { BetterAuthPlugin } from 'better-auth/types';

const DISPLAY_NAME_MAX_LENGTH = 128;
const AVATAR_URL_MAX_LENGTH = 2048;
const CONTROL_OR_UNPAIRED_SURROGATE =
  /[\p{Cc}\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF\uD800-\uDFFF]/u;

const invalidInput = (code: 'INVALID_AVATAR_URL' | 'INVALID_DISPLAY_NAME'): never => {
  throw new APIError('BAD_REQUEST', { code, message: code });
};

export const normalizeAccountEmail = (email: string): string => {
  if (email !== email.trim() || email !== email.normalize('NFKC')) {
    throw new APIError('BAD_REQUEST', { code: 'INVALID_EMAIL', message: 'INVALID_EMAIL' });
  }

  return email.toLowerCase();
};

export const validateAccountName = (name: string): string => {
  const normalized = name.trim();
  if (
    !normalized ||
    normalized.length > DISPLAY_NAME_MAX_LENGTH ||
    CONTROL_OR_UNPAIRED_SURROGATE.test(normalized)
  ) {
    return invalidInput('INVALID_DISPLAY_NAME');
  }

  return normalized;
};

export const validateAccountImage = (image: null | string): null | string => {
  if (image === null) return null;
  if (!image || image.length > AVATAR_URL_MAX_LENGTH || CONTROL_OR_UNPAIRED_SURROGATE.test(image)) {
    return invalidInput('INVALID_AVATAR_URL');
  }

  try {
    const url = new URL(image);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return invalidInput('INVALID_AVATAR_URL');
    }
  } catch {
    return invalidInput('INVALID_AVATAR_URL');
  }

  return image;
};

const hardenUserInput = <T extends { email?: string; image?: null | string; name?: string }>(
  user: T,
): T => ({
  ...user,
  ...(user.email !== undefined && { email: normalizeAccountEmail(user.email) }),
  ...(user.image !== undefined && { image: validateAccountImage(user.image) }),
  ...(user.name !== undefined && { name: validateAccountName(user.name) }),
});

export const accountInputHardening = (): BetterAuthPlugin => ({
  id: 'account-input-hardening',
  init: () => ({
    options: {
      databaseHooks: {
        user: {
          create: { before: async (user) => ({ data: hardenUserInput(user) }) },
          update: { before: async (user) => ({ data: hardenUserInput(user) }) },
        },
      },
    },
  }),
});
