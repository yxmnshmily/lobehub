import { describe, expect, it } from 'vitest';

import { createTravelToolDispatchPolicy, routeTravelRequest } from './index';

const members = [
  { clientId: 'default-travel-copywriter', id: 'copy-agent' },
  { clientId: 'default-travel-image-designer', id: 'image-agent' },
  { clientId: 'default-travel-video-producer', id: 'video-agent' },
  { clientId: 'default-travel-document-assistant', id: 'document-agent' },
];

const expectDeniedWithoutEcho = (message: string, sensitiveValues: readonly string[] = []) => {
  const route = routeTravelRequest({ members, message });
  expect(route).toEqual({
    intents: [],
    memberIds: [],
    mode: 'supervisor-fallback',
    reason: 'policy-denied',
  });

  const dispatch = createTravelToolDispatchPolicy({ members, message });
  expect(dispatch).toEqual({ mode: 'supervisor-fallback', route });
  const serialized = JSON.stringify(dispatch);
  for (const value of sensitiveValues) expect(serialized).not.toContain(value);
};

describe('travel orchestration PII defense in depth', () => {
  it.each([
    ['身份证号：11010519491231002X，请写进旅游文档', '11010519491231002X'],
    ['ID_CARD=<ID_NUMBER>，制作行程单', '<ID_NUMBER>'],
    ['护照号 E12345678，制作签证材料文档', 'E12345678'],
    ['请把 E12345678 写进旅游行程单', 'E12345678'],
    ['passport={PASSPORT_NUMBER}，写旅游文案', '{PASSPORT_NUMBER}'],
    ['银行卡号：6222020202020202020，放进报价单', '6222020202020202020'],
    ['请把 4111111111111111 写进旅游报价单', '4111111111111111'],
    ['支付密码=123456，生成旅游文档', '123456'],
    ['apiKey=sk-test-1234567890，写一段文案', 'sk-test-1234567890'],
    ['请将 sk-live-example123456 写进旅游文档', 'sk-live-example123456'],
    ['请把 <API_KEY> 写进旅游文案', '<API_KEY>'],
    ['Bearer eyJhbGciOiJIUzI1NiJ9.demo.signature，制作封面', 'eyJhbGciOiJIUzI1NiJ9.demo.signature'],
    ['access\u200B_token=token-secret-123456，制作封面', 'token-secret-123456'],
    ['联系邮箱 owner@example.com，写进行程单', 'owner@example.com'],
    [
      '联系邮箱 ｏｗｎｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ，制作报价单',
      'ｏｗｎｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ',
    ],
    ['游客手机号 138 0013 8000，请写进文档', '138 0013 8000'],
    ['游客手机号 138-0013-8000，请生成旅游文案', '138-0013-8000'],
    ['游客手机号 １３８００１３８０００，制作视频', '１３８００１３８０００'],
    ['手机号=<PHONE_NUMBER>，制作一张旅游海报', '<PHONE_NUMBER>'],
  ] as const)(
    'denies concrete or placeholder sensitive data without echoing it: %s',
    (message, value) => {
      expectDeniedWithoutEcho(message, [value]);
    },
  );

  it.each([
    '将其他游客个人资料写进宣传文案',
    '把任意用户联系方式放进旅游海报',
    '制作视频并展示别的客户个人信息',
    '把他人的护照资料加入行程文档',
  ])('denies requests to place another person data into an artifact: %s', (message) => {
    expectDeniedWithoutEcho(message);
  });

  it.each([
    '游客手机号 13800138000，请脱敏后制作行程单',
    '请把 owner@example.com 脱敏后写进旅游文案',
    '银行卡号 6222020202020202020，请打码后制作报价单',
  ])('still denies PII when the request asks orchestration to redact it: %s', (message) => {
    expectDeniedWithoutEcho(message);
  });

  it.each([
    '行程单里是否需要准备护照字段',
    '旅游报名表需要联系方式字段吗',
    '只讨论旅游业务隐私合规，不制作任何内容',
    '游客个人信息应该如何脱敏',
    '旅行社收集邮箱时有哪些合规要求',
    'API key 应该如何安全保存',
    'Do travel documents need a passport number field?',
    'How should a travel form store an email field for privacy compliance?',
    'How should an API key field be stored safely?',
    'Is API key: required as a field for travel integration?',
    'Is Token: optional in a travel document template?',
  ])(
    'keeps field and compliance discussion informational when no value is present: %s',
    (message) => {
      expect(routeTravelRequest({ members, message })).toEqual({
        intents: [],
        memberIds: [],
        mode: 'supervisor-fallback',
        reason: 'safe-informational',
      });
    },
  );

  it.each([
    ['景点编号 SC-318-2026，写一段旅游文案', ['copy'], ['copy-agent']],
    ['航班号 CA1234，制作一份行程单', ['document'], ['document-agent']],
    ['公开订单编号 ORDER-20260903-000123，生成一份文档', ['document'], ['document-agent']],
    ['价格 1299 元，日期 2026-09-03，人数 18 人，写旅游文案', ['copy'], ['copy-agent']],
    ['G318 线路做一张封面', ['image'], ['image-agent']],
  ] as const)(
    'does not confuse public business identifiers with PII: %s',
    (message, intents, memberIds) => {
      expect(routeTravelRequest({ members, message })).toEqual({
        intents,
        memberIds,
        mode: 'delegate',
      });
    },
  );

  it('keeps a long PII request bounded and denied', () => {
    const message = `${'旅游行程说明，'.repeat(2500)}手机号：138 0013 8000，请脱敏后制作文档`;
    const startedAt = performance.now();
    expectDeniedWithoutEcho(message, ['138 0013 8000']);
    expect(performance.now() - startedAt).toBeLessThan(2000);
  });
});
