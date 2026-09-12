import { isRecord } from '@lobechat/utils/object';

const EMAIL_IN_USE_CODES = new Set([
  'USER_ALREADY_EXISTS',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
]);

export const getEmailChangeErrorKey = (
  error: unknown,
): 'profile.emailChangeError' | 'profile.emailInUse' =>
  isRecord(error) && typeof error.code === 'string' && EMAIL_IN_USE_CODES.has(error.code)
    ? 'profile.emailInUse'
    : 'profile.emailChangeError';
