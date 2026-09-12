import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';

import type { VerifiedPlatformCreditPaymentEvent } from '@lobechat/database';

import { CREDIT_PURCHASE_UNIT } from '@/const/creditPurchase';

export type PaymentMethod = 'alipay' | 'wechat' | 'unionpay';
export type PaymentInstruction =
  | { type: 'form'; action: string; fields: Record<string, string> }
  | { type: 'qr'; codeUrl: string };
export type PaymentEnvironment = Record<string, string | undefined>;
export type PaymentOrder = {
  merchantOrderId: string;
  amountMinor: number;
  currency: string;
  createdAt: Date;
};

const methods: PaymentMethod[] = ['alipay', 'wechat', 'unionpay'];
const required: Record<PaymentMethod, string[]> = {
  alipay: ['ALIPAY_APP_ID', 'ALIPAY_SELLER_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY'],
  wechat: [
    'WECHAT_PAY_APP_ID',
    'WECHAT_PAY_MERCHANT_ID',
    'WECHAT_PAY_PRIVATE_KEY',
    'WECHAT_PAY_SERIAL_NO',
    'WECHAT_PAY_API_V3_KEY',
    'WECHAT_PAY_PUBLIC_KEY',
    'WECHAT_PAY_PUBLIC_KEY_ID',
  ],
  unionpay: [
    'UNIONPAY_MERCHANT_ID',
    'UNIONPAY_CERT_ID',
    'UNIONPAY_PRIVATE_KEY',
    'UNIONPAY_PUBLIC_KEY',
  ],
};
const prefix = { alipay: 'ALIPAY', wechat: 'WECHAT_PAY', unionpay: 'UNIONPAY' };
const pem = (value: string | undefined) => (value ?? '').replaceAll('\\n', '\n');
const fail = (): never => {
  throw new Error('Payment verification or configuration invalid');
};
const canonical = (values: Record<string, string>) =>
  Object.keys(values)
    .filter((k) => values[k] !== '')
    .sort()
    .map((k) => `${k}=${values[k]}`)
    .join('&');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const signature = (value: string, key: string | undefined) =>
  sign('RSA-SHA256', Buffer.from(value), pem(key)).toString('base64');
const checkSignature = (value: string, signed: string, key: string | undefined) => {
  if (!signed || !verify('RSA-SHA256', Buffer.from(value), pem(key), Buffer.from(signed, 'base64')))
    fail();
};
const chinaTime = (date: Date) =>
  new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
const externalOrderId = (id: string) => id.replaceAll('-', '');
const internalOrderId = (id: string) => {
  if (!/^[a-f0-9]{32}$/.test(id)) return fail();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
};
const positiveInteger = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) return fail();
  return value;
};
const decimalFen = (value: string) => {
  if (!/^\d+\.\d{2}$/.test(value)) return fail();
  return positiveInteger(Number(value.replace('.', '')));
};
const callbackBase = (env: PaymentEnvironment) => {
  const url = new URL(env.PAYMENT_PUBLIC_BASE_URL ?? '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail();
  return url.toString().replace(/\/$/, '');
};

const verifyWechat = (body: string, headers: Headers, env: PaymentEnvironment) => {
  const timestamp = headers.get('wechatpay-timestamp') ?? '';
  const nonce = headers.get('wechatpay-nonce') ?? '';
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !nonce ||
    headers.get('wechatpay-serial') !== env.WECHAT_PAY_PUBLIC_KEY_ID
  )
    fail();
  checkSignature(
    `${timestamp}\n${nonce}\n${body}\n`,
    headers.get('wechatpay-signature') ?? '',
    env.WECHAT_PAY_PUBLIC_KEY,
  );
};

export function getCheckoutConfig(env: PaymentEnvironment = process.env) {
  const value = env.PAYMENT_CNY_FEN_PER_MILLION ?? String(CREDIT_PURCHASE_UNIT.amountMinor);
  const unitAmountMinor =
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) > 0 &&
    Number(value) <= 100_000_000
      ? Number(value)
      : null;
  const available = (method: PaymentMethod) => {
    try {
      callbackBase(env);
      if (!unitAmountMinor || required[method].some((k) => !env[k]?.trim())) return false;
      const privateKey = createPrivateKey(pem(env[`${prefix[method]}_PRIVATE_KEY`]));
      const publicKey = createPublicKey(pem(env[`${prefix[method]}_PUBLIC_KEY`]));
      if (
        [privateKey, publicKey].some(
          (k) =>
            k.asymmetricKeyType !== 'rsa' || (k.asymmetricKeyDetails?.modulusLength ?? 0) < 2048,
        )
      )
        return false;
      return method !== 'wechat' || Buffer.byteLength(env.WECHAT_PAY_API_V3_KEY!) === 32;
    } catch {
      return false;
    }
  };
  return {
    currency: 'CNY' as const,
    unitAmountMinor,
    methods: methods.map((id) => ({ id, enabled: available(id) })),
  };
}

export async function createPayment(
  method: PaymentMethod,
  order: PaymentOrder,
  env: PaymentEnvironment = process.env,
): Promise<PaymentInstruction> {
  if (
    !getCheckoutConfig(env).methods.find((x) => x.id === method)?.enabled ||
    order.currency !== 'CNY'
  )
    fail();
  positiveInteger(order.amountMinor);
  const base = callbackBase(env);
  const notify = `${base}/api/payments/${method}/notify`;
  const returnUrl = `${base}/settings/credits#credit-orders`;
  const orderId = externalOrderId(order.merchantOrderId);
  internalOrderId(orderId);
  if (method === 'alipay') {
    const fields: Record<string, string> = {
      app_id: env.ALIPAY_APP_ID!,
      method: 'alipay.trade.page.pay',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: chinaTime(new Date()),
      version: '1.0',
      notify_url: notify,
      return_url: returnUrl,
      biz_content: JSON.stringify({
        out_trade_no: orderId,
        total_amount: (order.amountMinor / 100).toFixed(2),
        subject: '积分充值',
        product_code: 'FAST_INSTANT_TRADE_PAY',
        time_expire: chinaTime(new Date(order.createdAt.getTime() + 30 * 60_000)),
      }),
    };
    // Alipay needs charset in the URL before decoding the POST body for verification.
    const signed = signature(canonical(fields), env.ALIPAY_PRIVATE_KEY);
    const { charset, ...body } = fields;
    return {
      type: 'form',
      action: `https://openapi.alipay.com/gateway.do?charset=${charset}`,
      fields: { ...body, sign: signed },
    };
  }
  if (method === 'unionpay') {
    const fields: Record<string, string> = {
      version: '5.1.0',
      encoding: 'utf-8',
      certId: env.UNIONPAY_CERT_ID!,
      signMethod: '01',
      txnType: '01',
      txnSubType: '01',
      bizType: '000201',
      channelType: '07',
      accessType: '0',
      merId: env.UNIONPAY_MERCHANT_ID!,
      orderId,
      txnTime: chinaTime(order.createdAt).replaceAll(/[- :]/g, ''),
      txnAmt: String(order.amountMinor),
      currencyCode: '156',
      frontUrl: `${base}/api/payments/unionpay/return`,
      backUrl: notify,
      payTimeout: chinaTime(new Date(order.createdAt.getTime() + 30 * 60_000)).replaceAll(
        /[- :]/g,
        '',
      ),
    };
    return {
      type: 'form',
      action: 'https://gateway.95516.com/gateway/api/frontTransReq.do',
      fields: {
        ...fields,
        signature: signature(digest(canonical(fields)), env.UNIONPAY_PRIVATE_KEY),
      },
    };
  }
  const path = '/v3/pay/transactions/native';
  const body = JSON.stringify({
    appid: env.WECHAT_PAY_APP_ID,
    mchid: env.WECHAT_PAY_MERCHANT_ID,
    description: '积分充值',
    out_trade_no: orderId,
    notify_url: notify,
    time_expire: new Date(order.createdAt.getTime() + 30 * 60_000).toISOString(),
    amount: { total: order.amountMinor, currency: 'CNY' },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString('hex');
  const signed = signature(
    `POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`,
    env.WECHAT_PAY_PRIVATE_KEY,
  );
  const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
    method: 'POST',
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Wechatpay-Serial': env.WECHAT_PAY_PUBLIC_KEY_ID!,
      'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${env.WECHAT_PAY_MERCHANT_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${env.WECHAT_PAY_SERIAL_NO}",signature="${signed}"`,
    },
  });
  if (!response.ok) fail();
  const responseBody = await response.text();
  if (Buffer.byteLength(responseBody) > 65536) fail();
  verifyWechat(responseBody, response.headers, env);
  const result = JSON.parse(responseBody);
  if (
    typeof result.code_url !== 'string' ||
    !/^weixin:\/\/wxpay\/bizpayurl\?/.test(result.code_url) ||
    result.code_url.length > 2048
  )
    fail();
  return { type: 'qr', codeUrl: result.code_url };
}

export function verifyNotification(
  method: PaymentMethod,
  body: string,
  headers: Headers,
  env: PaymentEnvironment = process.env,
): VerifiedPlatformCreditPaymentEvent | null {
  if (Buffer.byteLength(body) > 65536) fail();
  if (method === 'wechat') {
    verifyWechat(body, headers, env);
    const envelope = JSON.parse(body);
    if (envelope.event_type !== 'TRANSACTION.SUCCESS') return null;
    const resource = envelope.resource;
    if (
      resource?.algorithm !== 'AEAD_AES_256_GCM' ||
      typeof resource.ciphertext !== 'string' ||
      typeof resource.nonce !== 'string'
    )
      fail();
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    if (encrypted.length <= 16) fail();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(env.WECHAT_PAY_API_V3_KEY ?? ''),
      Buffer.from(resource.nonce),
    );
    decipher.setAuthTag(encrypted.subarray(-16));
    decipher.setAAD(Buffer.from(resource.associated_data ?? ''));
    const payment = JSON.parse(
      Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString(
        'utf8',
      ),
    );
    if (
      payment.appid !== env.WECHAT_PAY_APP_ID ||
      payment.mchid !== env.WECHAT_PAY_MERCHANT_ID ||
      payment.trade_state !== 'SUCCESS' ||
      payment.amount?.currency !== 'CNY'
    )
      fail();
    const occurredAt = new Date(payment.success_time);
    if (
      !Number.isFinite(occurredAt.getTime()) ||
      typeof payment.transaction_id !== 'string' ||
      !payment.transaction_id ||
      payment.transaction_id.length > 255
    )
      fail();
    return {
      amountMinor: positiveInteger(payment.amount.total),
      currency: 'CNY',
      eventId: payment.transaction_id,
      eventType: 'payment_succeeded',
      merchantOrderId: internalOrderId(payment.out_trade_no),
      occurredAt,
      provider: method,
      providerPaymentId: payment.transaction_id,
    };
  }
  const values: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(body)) {
    if (Object.hasOwn(values, key)) fail();
    Object.defineProperty(values, key, { value, enumerable: true });
  }
  let amountMinor: number, paymentId: string, orderId: string, occurredAt: Date;
  if (method === 'alipay') {
    const { sign: signed, sign_type: signType, ...fields } = values;
    if (signType !== 'RSA2') fail();
    checkSignature(canonical(fields), signed, env.ALIPAY_PUBLIC_KEY);
    if (fields.app_id !== env.ALIPAY_APP_ID || fields.seller_id !== env.ALIPAY_SELLER_ID) fail();
    if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(fields.trade_status)) return null;
    amountMinor = decimalFen(fields.total_amount);
    paymentId = fields.trade_no;
    orderId = fields.out_trade_no;
    occurredAt = new Date(`${fields.gmt_payment?.replace(' ', 'T')}+08:00`);
  } else {
    const { signature: signed, ...fields } = values;
    checkSignature(digest(canonical(fields)), signed, env.UNIONPAY_PUBLIC_KEY);
    if (
      fields.merId !== env.UNIONPAY_MERCHANT_ID ||
      fields.currencyCode !== '156' ||
      fields.txnType !== '01' ||
      fields.txnSubType !== '01'
    )
      fail();
    if (fields.respCode !== '00') return null;
    if (!/^\d+$/.test(fields.txnAmt)) fail();
    amountMinor = positiveInteger(Number(fields.txnAmt));
    paymentId = fields.queryId;
    orderId = fields.orderId;
    if (!/^\d{14}$/.test(fields.txnTime)) fail();
    const t = fields.txnTime;
    occurredAt = new Date(
      `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}+08:00`,
    );
  }
  if (!paymentId || paymentId.length > 255 || !Number.isFinite(occurredAt.getTime())) fail();
  return {
    amountMinor,
    currency: 'CNY',
    eventId: paymentId,
    eventType: 'payment_succeeded',
    merchantOrderId: internalOrderId(orderId),
    occurredAt,
    provider: method,
    providerPaymentId: paymentId,
  };
}
