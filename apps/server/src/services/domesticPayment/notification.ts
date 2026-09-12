import { getServerDB } from '@/database/core/db-adaptor';

import type { PaymentEnvironment, PaymentMethod } from './gateways';
import { receivePayment } from './index';

/** A front-channel return is navigation only; no parameters can credit an account. */
export function handlePaymentReturn(env: PaymentEnvironment = process.env) {
  try {
    const base = new URL(env.PAYMENT_PUBLIC_BASE_URL ?? '');
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
      throw new Error('Invalid return URL');
    return Response.redirect(
      `${base.toString().replace(/\/$/, '')}/settings/credits#credit-orders`,
      303,
    );
  } catch {
    return new Response('Payment return unavailable', { status: 503 });
  }
}

/** Public webhook: authenticated by the provider signature, never by a browser session. */
export async function handlePaymentNotification(request: Request, method: string) {
  if (!['alipay', 'wechat', 'unionpay'].includes(method))
    return new Response('Not found', { status: 404 });
  if (!request.body || Number(request.headers.get('content-length') ?? 0) > 65536)
    return new Response('Payload too large', { status: 413 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        return new Response('Payload too large', { status: 413 });
      }
      chunks.push(value);
    }
    await receivePayment(
      await getServerDB(),
      method as PaymentMethod,
      Buffer.concat(chunks).toString('utf8'),
      request.headers,
    );
    return method === 'wechat' ? new Response(null, { status: 204 }) : new Response('success');
  } catch {
    // Do not acknowledge an uncommitted payment. Provider retry recovers transient DB failures.
    // Never log the callback body, merchant credentials or raw provider errors.
    return method === 'wechat'
      ? Response.json({ code: 'FAIL', message: 'Notification not accepted' }, { status: 503 })
      : new Response('failure', { status: 503 });
  } finally {
    reader.releaseLock();
  }
}
