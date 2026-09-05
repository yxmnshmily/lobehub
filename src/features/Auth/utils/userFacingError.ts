interface AuthErrorLike {
  code?: string;
}

const EMAIL_IN_USE_CODES = new Set([
  'USER_ALREADY_EXISTS',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
]);

export const getEmailChangeErrorKey = (
  error: AuthErrorLike,
): 'profile.emailChangeError' | 'profile.emailInUse' =>
  error.code && EMAIL_IN_USE_CODES.has(error.code)
    ? 'profile.emailInUse'
    : 'profile.emailChangeError';
