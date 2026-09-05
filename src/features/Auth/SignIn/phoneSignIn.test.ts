import { describe, expect, it } from 'vitest';

import { isFormValidationError, normalizePhone } from './phoneSignIn';

describe('phoneSignIn', () => {
  it('normalizes a mainland number for the auth API', () => {
    expect(normalizePhone('138 1234 5678')).toBe('+8613812345678');
    expect(normalizePhone('86-138-1234-5678')).toBe('+8613812345678');
  });

  it('distinguishes local form validation from network failures', () => {
    expect(isFormValidationError({ errorFields: [] })).toBe(true);
    expect(isFormValidationError(new Error('network failed'))).toBe(false);
  });
});
