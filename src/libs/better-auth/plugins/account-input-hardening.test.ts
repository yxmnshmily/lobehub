import type { APIError } from 'better-auth/api';
import { describe, expect, it } from 'vitest';

import {
  accountInputHardening,
  normalizeAccountEmail,
  validateAccountImage,
  validateAccountName,
} from './account-input-hardening';

describe('account input hardening', () => {
  it.each([
    ['Traveler\nAdmin', 'INVALID_DISPLAY_NAME'],
    ['Traveler\u0000Admin', 'INVALID_DISPLAY_NAME'],
    ['Traveler\u202EAdmin', 'INVALID_DISPLAY_NAME'],
    ['\uD800', 'INVALID_DISPLAY_NAME'],
    ['   ', 'INVALID_DISPLAY_NAME'],
  ])('rejects an unsafe display name', (name, code) => {
    expect(() => validateAccountName(name)).toThrowError(
      expect.objectContaining<Partial<APIError>>({ body: expect.objectContaining({ code }) }),
    );
  });

  it('trims safe display names without changing their Unicode content', () => {
    expect(validateAccountName('  旅行者 🚀  ')).toBe('旅行者 🚀');
  });

  it.each(['javascript:alert(1)', 'data:text/html,unsafe', 'https://u:p@example.test/a.png'])(
    'rejects a dangerous avatar URL',
    (image) => {
      expect(() => validateAccountImage(image)).toThrowError(
        expect.objectContaining<Partial<APIError>>({
          body: expect.objectContaining({ code: 'INVALID_AVATAR_URL' }),
        }),
      );
    },
  );

  it('accepts normal web avatar URLs and explicit removal', () => {
    expect(validateAccountImage('https://assets.example.test/avatar.png')).toBe(
      'https://assets.example.test/avatar.png',
    );
    expect(validateAccountImage(null)).toBeNull();
  });

  it('canonicalizes case while rejecting padded or compatibility-mutated email identities', () => {
    expect(normalizeAccountEmail('Traveler@Example.Test')).toBe('traveler@example.test');
    expect(() => normalizeAccountEmail(' traveler@example.test ')).toThrow();
    expect(() => normalizeAccountEmail('Ｔraveler@example.test')).toThrow();
  });

  it('applies the same validation before user creation and update', async () => {
    const plugin = accountInputHardening();
    const initialized = plugin.init?.({} as never);
    const options = await initialized;
    const hooks = options?.options?.databaseHooks?.user;

    await expect(
      hooks?.create?.before?.(
        {
          email: 'Traveler@Example.Test',
          image: 'https://assets.example.test/avatar.png',
          name: '  Traveler  ',
        } as never,
        null,
      ),
    ).resolves.toEqual({
      data: expect.objectContaining({ email: 'traveler@example.test', name: 'Traveler' }),
    });

    await expect(
      hooks?.update?.before?.({ image: 'javascript:alert(1)' } as never, null),
    ).rejects.toMatchObject({ body: expect.objectContaining({ code: 'INVALID_AVATAR_URL' }) });
  });
});
