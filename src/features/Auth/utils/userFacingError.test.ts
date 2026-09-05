import { describe, expect, it } from 'vitest';

import { getEmailChangeErrorKey } from './userFacingError';

describe('getEmailChangeErrorKey', () => {
  it.each(['USER_ALREADY_EXISTS', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'])(
    'maps duplicate address code %s to an understandable conflict message',
    (code) => {
      expect(getEmailChangeErrorKey({ code })).toBe('profile.emailInUse');
    },
  );

  it('falls back safely without returning backend details', () => {
    const error = {
      message: 'postgres://internal-host/users?token=secret-fixture',
      statusText: 'Internal Server Error',
    };

    expect(getEmailChangeErrorKey(error)).toBe('profile.emailChangeError');
    expect(getEmailChangeErrorKey(error)).not.toContain(error.message);
  });
});
