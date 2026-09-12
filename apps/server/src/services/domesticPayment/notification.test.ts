// @vitest-environment node
import { expect, it, vi } from 'vitest';

import { handlePaymentNotification, handlePaymentReturn } from './notification';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: () => {
    throw new Error('Database should not be used');
  },
}));

it('rejects unknown channels and oversized streaming bodies without touching the database', async () => {
  expect(
    (
      await handlePaymentNotification(
        new Request('https://example.test', { method: 'POST', body: 'test' }),
        'stripe',
      )
    ).status,
  ).toBe(404);
  const request = new Request('https://example.test', { method: 'POST', body: 'x'.repeat(65537) });
  expect((await handlePaymentNotification(request, 'wechat')).status).toBe(413);
});

it('returns from the UnionPay POST using a 303 and never trusts redirect parameters or credits on return', () => {
  const response = handlePaymentReturn({
    PAYMENT_PUBLIC_BASE_URL: 'https://travel.example/lobehub',
  });
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(
    'https://travel.example/lobehub/settings/credits#credit-orders',
  );
});
