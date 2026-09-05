export const normalizePhone = (value: string) =>
  `+86${value.replaceAll(/\D/g, '').replace(/^86/, '')}`;

export const isFormValidationError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  Array.isArray((error as { errorFields?: unknown[] }).errorFields);
