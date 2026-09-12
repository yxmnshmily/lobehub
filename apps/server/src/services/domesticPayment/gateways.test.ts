// @vitest-environment node
import { createCipheriv, createHash, generateKeyPairSync, sign, verify } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPayment, getCheckoutConfig, verifyNotification } from './gateways';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const env = {
  PAYMENT_PUBLIC_BASE_URL: 'https://travel.example/lobehub',
  PAYMENT_CNY_FEN_PER_MILLION: '672',
  ALIPAY_APP_ID: 'app123',
  ALIPAY_PRIVATE_KEY: privateKey,
  ALIPAY_PUBLIC_KEY: publicKey,
  ALIPAY_SELLER_ID: 'seller123',
  UNIONPAY_MERCHANT_ID: 'merchant123',
  UNIONPAY_CERT_ID: '123456',
  UNIONPAY_PRIVATE_KEY: privateKey,
  UNIONPAY_PUBLIC_KEY: publicKey,
  WECHAT_PAY_APP_ID: 'wx123',
  WECHAT_PAY_MERCHANT_ID: 'mch123',
  WECHAT_PAY_PRIVATE_KEY: privateKey,
  WECHAT_PAY_SERIAL_NO: 'serial123',
  WECHAT_PAY_PUBLIC_KEY: publicKey,
  WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_123',
  WECHAT_PAY_API_V3_KEY: '01234567890123456789012345678901',
};
const order = {
  merchantOrderId: '11111111-1111-4111-8111-111111111111',
  amountMinor: 672,
  currency: 'CNY',
  createdAt: new Date('2026-09-06T10:00:00Z'),
};
const canonical = (values: Record<string, string>) =>
  Object.keys(values)
    .sort()
    .map((k) => `${k}=${values[k]}`)
    .join('&');
const alipayNotice = (overrides = {}) => {
  const values = {
    app_id: 'app123',
    seller_id: 'seller123',
    out_trade_no: '11111111111141118111111111111111',
    trade_no: 'trade123',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '6.72',
    gmt_payment: '2026-09-06 18:00:01',
    notify_id: 'notice123',
    ...overrides,
  };
  return new URLSearchParams({
    ...values,
    sign_type: 'RSA2',
    sign: sign('RSA-SHA256', Buffer.from(canonical(values)), privateKey).toString('base64'),
  }).toString();
};
const wxHeaders = (body: string, timestamp = String(Math.floor(Date.now() / 1000))) =>
  new Headers({
    'Wechatpay-Timestamp': timestamp,
    'Wechatpay-Nonce': 'nonce123',
    'Wechatpay-Serial': 'PUB_KEY_ID_123',
    'Wechatpay-Signature': sign(
      'RSA-SHA256',
      Buffer.from(`${timestamp}\nnonce123\n${body}\n`),
      privateKey,
    ).toString('base64'),
  });
afterEach(() => vi.unstubAllGlobals());

describe('domestic payment trust boundary', () => {
  it('uses the approved 10 CNY selling price while keeping unconfigured channels unavailable', () => {
    expect(getCheckoutConfig({})).toMatchObject({ unitAmountMinor: 1000, currency: 'CNY' });
    expect(getCheckoutConfig({}).methods.every((x) => !x.enabled)).toBe(true);
    expect(getCheckoutConfig(env)).toMatchObject({ unitAmountMinor: 672 });
    expect(
      getCheckoutConfig({ ...env, PAYMENT_PUBLIC_BASE_URL: 'http://example.com' }).methods.every(
        (x) => !x.enabled,
      ),
    ).toBe(true);
  });

  it('signs an Alipay form with immutable CNY amount and the mounted callback URL', async () => {
    const payment = await createPayment('alipay', order, env);
    expect(payment.type).toBe('form');
    if (payment.type !== 'form') throw new Error('Expected form');
    const gateway = new URL(payment.action);
    expect(gateway.searchParams.get('charset')).toBe('utf-8');
    expect(payment.fields).not.toHaveProperty('charset');
    const { sign: signature, ...body } = payment.fields;
    const fields = { ...Object.fromEntries(gateway.searchParams), ...body };
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(canonical(fields)),
        publicKey,
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(true);
    expect(JSON.parse(fields.biz_content)).toMatchObject({
      subject: '积分充值',
      total_amount: '6.72',
      out_trade_no: '11111111111141118111111111111111',
    });
    expect(fields.notify_url).toBe('https://travel.example/lobehub/api/payments/alipay/notify');
    await expect(createPayment('alipay', { ...order, currency: 'USD' }, env)).rejects.toThrow();
  });

  it('signs the UnionPay front gateway payload using the protocol SHA256 digest', async () => {
    const payment = await createPayment('unionpay', order, env);
    if (payment.type !== 'form') throw new Error('Expected form');
    const { signature, ...fields } = payment.fields;
    expect(payment.action).toBe('https://gateway.95516.com/gateway/api/frontTransReq.do');
    expect(fields).toMatchObject({ txnAmt: '672', currencyCode: '156', txnTime: '20260906180000' });
    const digest = createHash('sha256').update(canonical(fields)).digest('hex');
    expect(
      verify('RSA-SHA256', Buffer.from(digest), publicKey, Buffer.from(signature, 'base64')),
    ).toBe(true);
  });

  it('verifies UnionPay callbacks against the pinned key and this merchant', () => {
    const notice = (overrides = {}) => {
      const fields = {
        merId: 'merchant123',
        currencyCode: '156',
        txnType: '01',
        txnSubType: '01',
        respCode: '00',
        txnAmt: '672',
        queryId: 'union-trade-123',
        txnTime: '20260906180000',
        orderId: '11111111111141118111111111111111',
        ...overrides,
      };
      return new URLSearchParams({
        ...fields,
        signature: sign(
          'RSA-SHA256',
          Buffer.from(createHash('sha256').update(canonical(fields)).digest('hex')),
          privateKey,
        ).toString('base64'),
      }).toString();
    };
    expect(verifyNotification('unionpay', notice(), new Headers(), env)).toMatchObject({
      amountMinor: 672,
      merchantOrderId: order.merchantOrderId,
      providerPaymentId: 'union-trade-123',
    });
    expect(() =>
      verifyNotification(
        'unionpay',
        notice().replace('txnAmt=672', 'txnAmt=1'),
        new Headers(),
        env,
      ),
    ).toThrow();
    expect(() =>
      verifyNotification('unionpay', notice({ merId: 'another-merchant' }), new Headers(), env),
    ).toThrow();
    expect(
      verifyNotification('unionpay', notice({ respCode: '03' }), new Headers(), env),
    ).toBeNull();
  });

  it('accepts only signed Alipay success for this app and seller', () => {
    const event = verifyNotification('alipay', alipayNotice(), new Headers(), env);
    expect(event).toMatchObject({
      amountMinor: 672,
      currency: 'CNY',
      merchantOrderId: order.merchantOrderId,
      provider: 'alipay',
    });
    expect(() =>
      verifyNotification('alipay', alipayNotice().replace('6.72', '0.01'), new Headers(), env),
    ).toThrow();
    expect(() =>
      verifyNotification('alipay', alipayNotice({ seller_id: 'another' }), new Headers(), env),
    ).toThrow();
    expect(() =>
      verifyNotification('alipay', alipayNotice({ total_amount: '6.721' }), new Headers(), env),
    ).toThrow();
    expect(
      verifyNotification(
        'alipay',
        alipayNotice({ trade_status: 'WAIT_BUYER_PAY' }),
        new Headers(),
        env,
      ),
    ).toBeNull();
    expect(() =>
      verifyNotification('alipay', `${alipayNotice()}&total_amount=6.72`, new Headers(), env),
    ).toThrow();
  });

  it('validates the signed WeChat API response before exposing its QR code', async () => {
    const response = JSON.stringify({ code_url: 'weixin://wxpay/bizpayurl?pr=abc123' });
    let requestBody = '';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requestBody = String(init.body);
      return new Response(response, { headers: wxHeaders(response) });
    });
    await expect(createPayment('wechat', order, env)).resolves.toEqual({
      type: 'qr',
      codeUrl: 'weixin://wxpay/bizpayurl?pr=abc123',
    });
    expect(JSON.parse(requestBody)).toMatchObject({
      amount: { total: 672, currency: 'CNY' },
      mchid: 'mch123',
      appid: 'wx123',
    });
    vi.stubGlobal('fetch', async () => new Response(response));
    await expect(createPayment('wechat', order, env)).rejects.toThrow();
  });

  it('verifies and decrypts WeChat notifications and rejects stale or altered messages', () => {
    const resource = JSON.stringify({
      appid: 'wx123',
      mchid: 'mch123',
      out_trade_no: '11111111111141118111111111111111',
      transaction_id: 'wxtrade123',
      trade_state: 'SUCCESS',
      success_time: '2026-09-06T18:00:01+08:00',
      amount: { total: 672, currency: 'CNY' },
    });
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(env.WECHAT_PAY_API_V3_KEY),
      Buffer.from('012345678901'),
    );
    cipher.setAAD(Buffer.from('transaction'));
    const ciphertext = Buffer.concat([
      cipher.update(resource),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');
    const body = JSON.stringify({
      id: 'wxnotice',
      event_type: 'TRANSACTION.SUCCESS',
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        nonce: '012345678901',
        associated_data: 'transaction',
        ciphertext,
      },
    });
    expect(verifyNotification('wechat', body, wxHeaders(body), env)).toMatchObject({
      provider: 'wechat',
      providerPaymentId: 'wxtrade123',
      amountMinor: 672,
    });
    expect(() => verifyNotification('wechat', body, wxHeaders(body, '1'), env)).toThrow();
    expect(() =>
      verifyNotification('wechat', body.replace('wxnotice', 'tamper'), wxHeaders(body), env),
    ).toThrow();
    expect(() =>
      verifyNotification('wechat', body, wxHeaders(body), {
        ...env,
        WECHAT_PAY_MERCHANT_ID: 'other',
      }),
    ).toThrow();
  });
});
