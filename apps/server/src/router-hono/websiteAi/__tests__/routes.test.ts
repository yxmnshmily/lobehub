import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The homepage remains static ESM; this import is the cross-project contract boundary.
import {
  createHomepageAiClient,
  createHomepageAiDisplayState,
} from '../../../../../../../website/assets/pages/home/index/ai-client.mjs';
import rawApp from '../index';

let routeRequestSequence = 0;
// Route behavior tests get a unique valid key by default; rawApp is used when absence is the contract.
const app = new Proxy(rawApp, {
  get(target, property, receiver) {
    if (property !== 'request') return Reflect.get(target, property, receiver);

    return (input: URL | RequestInfo, options: RequestInit = {}) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
        'http://localhost',
      );
      const method = (
        options.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      if (url.pathname !== '/api/website-ai/chat' || method !== 'POST') {
        return target.request(input, options);
      }

      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(options.headers).forEach((value, key) => headers.set(key, value));
      if (!headers.has('Idempotency-Key')) {
        routeRequestSequence += 1;
        headers.set('Idempotency-Key', `website-ai-route-${routeRequestSequence}`);
      }

      if (input instanceof Request) {
        return target.request(new Request(input, { ...options, headers }));
      }
      return target.request(input, { ...options, headers });
    };
  },
});

const mocks = vi.hoisted(() => ({
  getServerDB: vi.fn(() => Promise.resolve({})),
  getSession: vi.fn(),
  getCapabilities: vi.fn(),
  findGroup: vi.fn(),
  findTravelTask: vi.fn(),
  findUser: vi.fn(),
  groupModelUsers: [] as string[],
  reconcile: vi.fn(),
  redisClient: null as {
    eval: (...args: unknown[]) => Promise<unknown>;
    set: (...args: unknown[]) => Promise<unknown>;
  } | null,
  start: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('@/libs/better-auth/getActiveSession', () => ({ getActiveSession: mocks.getSession }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://public.example' } }));
vi.mock('@/envs/auth', () => ({
  authEnv: { AUTH_SECRET: 'website-ai-session-fingerprint-test-secret' },
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));
vi.mock('@/database/models/user', () => ({
  UserModel: { findById: mocks.findUser },
}));
vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: class {
    private readonly userId: string;

    constructor(_db: unknown, userId: string) {
      this.userId = userId;
      mocks.groupModelUsers.push(userId);
    }

    findByClientId = (clientId: string) => mocks.findGroup(this.userId, clientId);
  },
}));
vi.mock('@/database/models/travelGeneration', () => ({
  TravelGenerationTaskModel: class {
    private readonly userId: string;

    constructor(_db: unknown, userId: string) {
      this.userId = userId;
    }

    findById = (taskId: string) => mocks.findTravelTask(this.userId, taskId);
  },
}));
vi.mock('@/server/services/user/travelServiceGroup', () => ({
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID: 'default-travel-service-group',
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => mocks.redisClient,
}));
vi.mock('@/server/services/travelGeneration/production', () => ({
  createTravelGenerationSettlementService: vi.fn(() => ({ reconcile: mocks.reconcile })),
}));
vi.mock('@/server/services/websiteAi', () => ({
  getWebsiteAiCapabilities: mocks.getCapabilities,
  WEBSITE_AI_BALANCE_CHECK_UNAVAILABLE: {
    code: 'BALANCE_CHECK_UNAVAILABLE',
    message: '暂时无法确认 Credits 余额，请稍后重试。',
  },
  WEBSITE_AI_BALANCE_INSUFFICIENT: {
    code: 'BALANCE_EMPTY',
    message: 'Credits 余额不足，请充值后重试。',
  },
  WEBSITE_AI_CONTENT_BLOCKED: { code: 'CONTENT_BLOCKED', message: '请求内容未通过安全检查。' },
  WEBSITE_AI_GROUP_NOT_PRIVATE: {
    code: 'TRAVEL_GROUP_NOT_PRIVATE',
    message: '旅游服务群组必须保持为用户私有群组。',
  },
  WEBSITE_AI_GENERATION_LIMIT_REQUIRED: {
    code: 'GENERATION_LIMIT_REQUIRED',
    message: '提交制作任务前必须设置有效的 Credits 上限。',
  },
  WEBSITE_AI_IMAGE_USAGE_UNAVAILABLE: {
    code: 'CAPABILITY_UNAVAILABLE',
    message: '当前图片生成尚未接入可核验的用量预留，暂不提交生成任务。',
  },
  WEBSITE_AI_IMAGE_MODEL_UNAVAILABLE: {
    code: 'PLATFORM_IMAGE_MODEL_UNAVAILABLE',
    message: '平台当前没有可用的图片模型。',
  },
  WEBSITE_AI_PRODUCTION_CAPABILITY_UNAVAILABLE: {
    code: 'CAPABILITY_UNAVAILABLE',
    message: '当前旅游内容制作与咨询暂不可用，请稍后再试。',
  },
  WEBSITE_AI_SERVICE_BILLING_UNAVAILABLE: {
    code: 'SERVICE_BILLING_UNAVAILABLE',
    message: '该制作类型的订单结算尚未启用。',
  },
  WEBSITE_AI_SUPERVISOR_FALLBACK_DENIED: {
    code: 'SUPERVISOR_FALLBACK_DENIED',
    message: '该咨询无法通过安全策略，请改写后重试。',
  },
  WEBSITE_AI_SUPERVISOR_INVALID: {
    code: 'TRAVEL_SUPERVISOR_INVALID',
    message: '旅游服务群组缺少有效的“旅游群主AI”监督者。',
  },
  WEBSITE_AI_VIDEO_USAGE_UNAVAILABLE: {
    code: 'VIDEO_USAGE_UNAVAILABLE',
    message: '平台视频用量结算尚不可用。',
  },
  WebsiteAiService: class {
    start = mocks.start;
    streamManager = () => ({ subscribeStreamEvents: mocks.subscribe });
  },
}));

const expectPrivateResponseHeaders = (response: Response) => {
  expect(response.headers.get('cache-control')).toMatch(/private/);
  expect(response.headers.get('cache-control')).toMatch(/no-store/);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('vary')).toMatch(/Origin/);
  expect(response.headers.get('vary')).toMatch(/Cookie/);
};

let contractRequestSequence = 0;
const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};
const yieldToStreamReader = () => new Promise<void>((resolve) => setImmediate(resolve));
const createImmediateLeaseRedis = () => {
  const claimed = new Map<string, string>();
  return {
    claimed,
    client: {
      eval: async (...args: unknown[]) => {
        const [, , keyValue, ownerValue, nextValue, _ttl] = args;
        const key = String(keyValue);
        const owner = String(ownerValue);
        if (key.startsWith('website-ai:previous-turn:')) {
          const raw = claimed.get(key);
          if (!raw) return 0;
          const record = JSON.parse(raw) as Record<string, unknown>;
          if (record.owner !== owner) return 0;
          if (nextValue === 'succeeded') {
            record.taskStatus = 'succeeded';
            claimed.set(key, JSON.stringify(record));
          } else {
            claimed.delete(key);
          }
          return 1;
        }
        if (claimed.get(key) !== owner) return 0;
        if (nextValue !== undefined) return 1;
        claimed.delete(key);
        return 1;
      },
      set: async (...args: unknown[]) => {
        const [keyValue, ownerValue] = args;
        const key = String(keyValue);
        if (claimed.has(key)) return null;
        claimed.set(key, String(ownerValue));
        return 'OK';
      },
    },
  };
};
const activeWebsiteAiStreamKeys = (claimed: Map<string, string>) =>
  [...claimed.keys()].filter((key) => key.startsWith('website-ai:stream:v1:'));

const createContractClient = () =>
  createHomepageAiClient({
    createIdempotencyKey: () => `website-ai-contract-${(contractRequestSequence += 1)}`,
    fetch: async (input: URL | RequestInfo, options: RequestInit = {}) =>
      await app.request(
        new URL(input instanceof Request ? input.url : input.toString(), 'http://localhost'),
        {
          ...options,
          headers: {
            ...Object.fromEntries(new Headers(options.headers)),
            Origin: 'http://localhost',
          },
        },
      ),
  });

describe('website AI routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.groupModelUsers.length = 0;
    mocks.redisClient = null;
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.findUser.mockResolvedValue({
      banExpires: null,
      banned: false,
      emailVerified: true,
      id: 'user-1',
    });
    mocks.getCapabilities.mockResolvedValue({
      copy: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
      document: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
      image: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
      video: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
    });
    mocks.findGroup.mockResolvedValue({ id: 'group-1', visibility: 'private' });
    mocks.findTravelTask.mockResolvedValue({
      groupId: 'group-1',
      id: 'travel-task-1',
      userId: 'user-1',
    });
    mocks.start.mockResolvedValue({
      assistantMessageId: 'assistant-1',
      operationId: 'operation-1',
      progressMembers: [{ id: 'agt-copy', name: '旅游文案助理' }],
      topicId: 'topic-1',
      userMessageId: 'user-message-1',
    });
    mocks.reconcile.mockResolvedValue({
      artifacts: [
        {
          content: 'internal artifact payload',
          generationId: 'generation-1',
          mimeType: 'image/png',
          name: '封面图',
          type: 'image',
          url: '/f/image-1',
        },
      ],
      id: 'travel-task-1',
      input: { prompt: '内部生成提示词' },
      orderId: '00000000-0000-4000-8000-000000000001',
      owner: { groupId: 'group-1', userId: 'user-1' },
      provider: 'secret-provider',
      status: 'succeeded',
      type: 'image',
    });
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
      onEvents([
        {
          data: { reason: 'completed', uiMessages: [] },
          operationId: 'operation-1',
          stepIndex: 1,
          timestamp: 1,
          type: 'agent_runtime_end',
        },
      ]);
    });
  });

  it('requires the existing LobeHub user session', async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await app.request('/api/website-ai/chat', {
      body: JSON.stringify({ message: '你好' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([
    [
      'unverified email',
      () => {
        mocks.getSession.mockResolvedValue({
          user: { banned: false, emailVerified: true, id: 'user-1' },
        });
        mocks.findUser.mockResolvedValue({ banned: false, emailVerified: false, id: 'user-1' });
      },
    ],
    [
      'active ban',
      () =>
        mocks.findUser.mockResolvedValue({
          banExpires: new Date(Date.now() + 60_000),
          banned: true,
          emailVerified: true,
          id: 'user-1',
        }),
    ],
    [
      'expired but not lifted ban',
      () =>
        mocks.findUser.mockResolvedValue({
          banExpires: new Date(Date.now() - 60_000),
          banned: true,
          emailVerified: true,
          id: 'user-1',
        }),
    ],
    ['deleted account', () => mocks.findUser.mockResolvedValue(undefined)],
    ['revoked session', () => mocks.getSession.mockResolvedValue(null)],
  ])('uniformly rejects a %s before any website AI work', async (_label, arrange) => {
    arrange();
    const responses = await Promise.all([
      app.request('http://localhost/api/website-ai/session'),
      app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ prompt: '不得启动' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      }),
      app.request('http://localhost/api/website-ai/generation/status', {
        body: JSON.stringify({ taskId: '不得查询' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      }),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    expect(bodies).toEqual([
      {
        error: {
          code: 'ACCOUNT_UNAVAILABLE',
          message: '当前账号暂不可使用官网 AI，请重新登录后再试。',
        },
      },
      {
        error: {
          code: 'ACCOUNT_UNAVAILABLE',
          message: '当前账号暂不可使用官网 AI，请重新登录后再试。',
        },
      },
      {
        error: {
          code: 'ACCOUNT_UNAVAILABLE',
          message: '当前账号暂不可使用官网 AI，请重新登录后再试。',
        },
      },
    ]);
    expect(mocks.getCapabilities).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('admits a verified account only after its ban flag is lifted', async () => {
    mocks.findUser.mockResolvedValue({
      banExpires: null,
      banned: false,
      emailVerified: true,
      id: 'user-1',
    });

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '解封后正常使用' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.findUser).toHaveBeenCalledWith(expect.anything(), 'user-1');
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it('rejects cross-origin mutation requests', async () => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ message: '你好' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://attacker.example' },
      method: 'POST',
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('does not trust caller-controlled forwarded host headers', async () => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '伪造转发头' }),
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://attacker.example',
        'X-Forwarded-Host': 'attacker.example',
        'X-Forwarded-Proto': 'https',
      },
      method: 'POST',
    });

    expect(response.status).toBe(403);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('accepts the configured public origin behind an internal proxy URL', async () => {
    const response = await app.request('http://internal-backend/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '合法公开站点请求' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://public.example' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://public.example');
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    await response.text();
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it('rejects a mutation with no Origin even when it has a session', async () => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '你好' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('answers only a trusted credentialed preflight without starting or authenticating a task', async () => {
    const trusted = await app.request('http://internal-backend/api/website-ai/chat', {
      headers: {
        'Access-Control-Request-Headers': 'content-type,idempotency-key,last-event-id',
        'Access-Control-Request-Method': 'POST',
        'Origin': 'https://public.example',
      },
      method: 'OPTIONS',
    });
    const attacker = await app.request('http://internal-backend/api/website-ai/chat', {
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Origin': 'https://attacker.example',
      },
      method: 'OPTIONS',
    });

    expect(trusted.status).toBe(204);
    expect(trusted.headers.get('access-control-allow-origin')).toBe('https://public.example');
    expect(trusted.headers.get('access-control-allow-credentials')).toBe('true');
    expect(trusted.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(trusted.headers.get('access-control-allow-methods')).toContain('POST');
    expect(trusted.headers.get('access-control-allow-headers')).toContain('Idempotency-Key');
    expect(attacker.status).toBe(403);
    expect(attacker.headers.get('access-control-allow-origin')).toBeNull();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('rejects caller-controlled identity and model-routing fields', async () => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({
        agentId: 'attacker-agent',
        groupId: 'attacker-group',
        model: 'attacker-model',
        pricing: { input: 0 },
        banned: false,
        emailVerified: true,
        prompt: '帮我做一份行程',
        provider: 'attacker-provider',
        userId: 'attacker-user',
        workspaceId: 'attacker-workspace',
      }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(422);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['overlong', 'x'.repeat(2001)],
  ])('rejects an %s prompt before starting a task', async (_label, prompt) => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(422);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('requires an idempotency key for every valid chat request', async () => {
    const response = await rawApp.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '帮我做一份行程' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid idempotency key' },
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('accepts the documented upper bounds and printable ASCII idempotency keys', async () => {
    const response = await rawApp.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({
        maxCredits: Number.MAX_SAFE_INTEGER,
        prompt: 'x'.repeat(2000),
        topicId: 't'.repeat(128),
      }),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'printable key 1',
        'Origin': 'http://localhost',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it.each([
    ['tab', 'invalid\tkey'],
    ['control byte', 'invalid\x1Fkey'],
    ['delete byte', 'invalid\x7Fkey'],
    ['extended byte', 'invalid\x80key'],
  ])('rejects a non-printable ASCII idempotency key containing a %s', async (_label, key) => {
    const response = await rawApp.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '字符合同测试' }),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        'Origin': 'http://localhost',
      },
      method: 'POST',
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid idempotency key' },
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([
    ['topic id', { body: { prompt: '字段上限测试', topicId: 't'.repeat(129) }, headers: {} }],
    [
      'idempotency key',
      { body: { prompt: '字段上限测试' }, headers: { 'Idempotency-Key': 'k'.repeat(129) } },
    ],
    [
      'stream cursor',
      {
        body: { prompt: '字段上限测试' },
        headers: {
          'Idempotency-Key': 'bounded-cursor',
          'Last-Event-ID': `${'1'.repeat(63)}-0`,
        },
      },
    ],
  ])('rejects an overlong %s before starting a task', async (_label, input) => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify(input.body),
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost',
        ...input.headers,
      },
      method: 'POST',
    });

    expect(response.status).toBe(422);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and a JSON body sent with a non-JSON media type', async () => {
    const malformed = await app.request('http://localhost/api/website-ai/chat', {
      body: '{"prompt":',
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const wrongMediaType = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '不应接受' }),
      headers: { 'Content-Type': 'text/plain', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(malformed.status).toBe(422);
    expect(wrongMediaType.status).toBe(415);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared request before starting a task', async () => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '不应读取或启动' }),
      headers: {
        'Content-Length': String(64 * 1024 + 1),
        'Content-Type': 'application/json',
        'Origin': 'http://localhost',
      },
      method: 'POST',
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('bounds an oversized body without Content-Length before the chat handler starts', async () => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ padding: 'x'.repeat(64 * 1024), prompt: '不应启动' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(413);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('returns a terminal error when a subscription ends without an agent terminal event', async () => {
    mocks.subscribe.mockResolvedValue(undefined);

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '测试非完整流' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const body = await response.text();

    expectPrivateResponseHeaders(response);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toMatch(/no-transform/);
    expect(response.headers.get('connection')).toBe('keep-alive');
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(body).toContain('event: error');
    expect(body).toContain('"code":"STREAM_INCOMPLETE"');
    expect(body).toContain('event: done');
    expect(body).toContain('"reason":"stream_incomplete"');
    expect(body.match(/^event: done$/gm)).toHaveLength(1);
  });

  it('maps the real runtime done reason and emits one terminal when the subscriber later fails', async () => {
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
      onEvents([
        {
          data: { reason: 'done', uiMessages: [] },
          operationId: 'operation-1',
          stepIndex: 1,
          timestamp: 1,
          type: 'agent_runtime_end',
        },
      ]);
      throw new Error('late subscriber failure with private details');
    });

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '唯一终态' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const body = await response.text();

    expect(body.match(/^event: done$/gm)).toHaveLength(1);
    expect(body).toContain('"reason":"completed"');
    expect(body).not.toContain('AGENT_ERROR');
    expect(body).not.toMatch(/STREAM_ERROR|late subscriber|private details/);
  });

  it.each(['usage missing', 'settlement failed'])(
    'withholds informational text when platform billing ends with %s',
    async (_failure) => {
      const privateOutput = '未结算的模型正文，包含敏感提示 PRIVATE_PROMPT';
      mocks.start.mockResolvedValueOnce({
        assistantMessageId: 'assistant-1',
        operationId: 'operation-1',
        progressMembers: [],
        responseDelivery: 'settlement-gated-text',
        topicId: 'topic-1',
        userMessageId: 'user-message-1',
      });
      mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
        onEvents([
          {
            data: { chunkType: 'text', content: privateOutput },
            id: '51-0',
            operationId: 'operation-1',
            stepIndex: 1,
            timestamp: 1,
            type: 'stream_chunk',
          },
          {
            data: {
              reason: 'error',
              reasonDetail: `private provider ${_failure}`,
              uiMessages: [],
            },
            operationId: 'operation-1',
            stepIndex: 1,
            timestamp: 2,
            type: 'agent_runtime_end',
          },
        ]);
      });

      const response = await app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ prompt: '只咨询路线，不执行工具' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      });
      const body = await response.text();

      expect(body).not.toContain(privateOutput);
      expect(body).not.toMatch(/PRIVATE_PROMPT|private provider|usage missing|settlement failed/);
      expect(body).toContain('"code":"AGENT_ERROR"');
      expect(body.match(/^event: done$/gm)).toHaveLength(1);
      expect(body).not.toContain('"reason":"completed"');
    },
  );

  it('releases informational text only after the settled runtime terminal', async () => {
    let receiveEvents: ((events: unknown[]) => void) | undefined;
    mocks.start.mockResolvedValueOnce({
      assistantMessageId: 'assistant-1',
      operationId: 'operation-1',
      progressMembers: [],
      responseDelivery: 'settlement-gated-text',
      topicId: 'topic-1',
      userMessageId: 'user-message-1',
    });
    mocks.subscribe.mockImplementation(
      async (_id, _cursor, onEvents, signal: AbortSignal | undefined) =>
        await new Promise<void>((resolve) => {
          receiveEvents = onEvents;
          signal?.addEventListener('abort', () => resolve());
        }),
    );

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '只咨询川西路线，不执行工具' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const chunks = [decoder.decode((await reader.read()).value)];

    receiveEvents?.([
      {
        data: { chunkType: 'text', content: '结算后可见的路线建议' },
        id: '61-0',
        operationId: 'operation-1',
        stepIndex: 1,
        timestamp: 1,
        type: 'stream_chunk',
      },
    ]);
    const pendingRead = reader.read();
    await expect(
      Promise.race([
        pendingRead.then(() => 'released'),
        yieldToStreamReader().then(() => 'pending'),
      ]),
    ).resolves.toBe('pending');

    receiveEvents?.([
      {
        data: {
          reason: 'done',
          uiMessages: [],
          usage: {
            cost: 0.0006,
            totalInputTokens: 100,
            totalOutputTokens: 50,
            totalTokens: 150,
          },
        },
        operationId: 'operation-1',
        stepIndex: 1,
        timestamp: 2,
        type: 'agent_runtime_end',
      },
    ]);
    chunks.push(decoder.decode((await pendingRead).value));
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(decoder.decode(result.value));
    }
    const body = chunks.join('');

    expect(body).toContain('结算后可见的路线建议');
    expect(body).toContain('"reason":"completed"');
    expect(body.match(/^event: done$/gm)).toHaveLength(1);
    expect(body).not.toMatch(/event: usage|totalInputTokens|totalOutputTokens|totalTokens|cost/);
  });

  it('settles only the opaque server previous-turn handle after one successful runtime terminal', async () => {
    const redis = createImmediateLeaseRedis();
    mocks.redisClient = redis.client;
    const handle = {
      key: `website-ai:previous-turn:v1:${'a'.repeat(64)}`,
      owner: 'current-turn-owner',
    };
    redis.claimed.set(
      handle.key,
      JSON.stringify({
        confirmedIntents: ['document'],
        owner: handle.owner,
        taskStatus: 'running',
        version: 1,
      }),
    );
    mocks.start.mockResolvedValueOnce({
      assistantMessageId: 'assistant-1',
      operationId: 'operation-1',
      previousTurnHandle: handle,
      progressMembers: [{ id: 'agt-copy', name: '旅游文案助理' }],
      topicId: 'topic-1',
      userMessageId: 'user-message-1',
    });
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
      onEvents([
        {
          data: { reason: 'done', uiMessages: [] },
          operationId: 'operation-1',
          stepIndex: 1,
          timestamp: 1,
          type: 'agent_runtime_end',
        },
      ]);
    });

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '完成当前结构化意图' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const body = await response.text();
    const stored = JSON.parse(redis.claimed.get(handle.key) ?? '{}');

    expect(stored).toEqual({
      confirmedIntents: ['document'],
      owner: handle.owner,
      taskStatus: 'succeeded',
      version: 1,
    });
    expect(body).toContain('"reason":"completed"');
    expect(body.match(/^event: done$/gm)).toHaveLength(1);
  });

  it('deletes the server previous-turn projection after a failed runtime terminal', async () => {
    const redis = createImmediateLeaseRedis();
    mocks.redisClient = redis.client;
    const handle = {
      key: `website-ai:previous-turn:v1:${'b'.repeat(64)}`,
      owner: 'failed-turn-owner',
    };
    redis.claimed.set(
      handle.key,
      JSON.stringify({
        confirmedIntents: ['copy'],
        owner: handle.owner,
        taskStatus: 'running',
        version: 1,
      }),
    );
    mocks.start.mockResolvedValueOnce({
      assistantMessageId: 'assistant-1',
      operationId: 'operation-1',
      previousTurnHandle: handle,
      progressMembers: [],
      topicId: 'topic-1',
      userMessageId: 'user-message-1',
    });
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
      onEvents([
        {
          data: { reason: 'error', uiMessages: [] },
          operationId: 'operation-1',
          stepIndex: 1,
          timestamp: 1,
          type: 'agent_runtime_end',
        },
      ]);
    });

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '失败不应成为下一轮上下文' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const body = await response.text();

    expect(redis.claimed.has(handle.key)).toBe(false);
    expect(body).toContain('"code":"AGENT_ERROR"');
    expect(body.match(/^event: done$/gm)).toHaveLength(1);
  });

  it('emits exactly one terminal event when duplicate runtime terminals arrive together', async () => {
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
      onEvents([
        {
          data: { reason: 'interrupted', uiMessages: [] },
          operationId: 'operation-1',
          stepIndex: 1,
          timestamp: 1,
          type: 'agent_runtime_end',
        },
        {
          data: { reason: 'completed', uiMessages: [] },
          operationId: 'operation-1',
          stepIndex: 2,
          timestamp: 2,
          type: 'agent_runtime_end',
        },
      ]);
    });

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '重复终态保护' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const body = await response.text();

    expect(body.match(/^event: done$/gm)).toHaveLength(1);
    expect(body).toContain('"reason":"interrupted"');
  });

  it.each([
    [
      'delta',
      {
        data: { chunkType: 'text', content: 'x'.repeat(64 * 1024 + 1) },
        id: 'oversized-delta',
        operationId: 'operation-1',
        stepIndex: 1,
        timestamp: 1,
        type: 'stream_chunk',
      },
    ],
    [
      'artifact',
      {
        data: {
          reason: 'completed',
          uiMessages: [
            {
              works: [
                {
                  id: 'artifact-1',
                  title: 'x'.repeat(64 * 1024 + 1),
                  type: 'image',
                  url: '/f/artifact-1',
                },
              ],
            },
          ],
        },
        operationId: 'operation-1',
        stepIndex: 1,
        timestamp: 1,
        type: 'agent_runtime_end',
      },
    ],
  ])('terminates safely instead of emitting one oversized SSE %s', async (_label, event) => {
    const redis = createImmediateLeaseRedis();
    mocks.redisClient = redis.client;
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
      onEvents([event]);
    });

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '单事件上限测试' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const body = await response.text();

    expect(body).toContain('"code":"STREAM_LIMIT"');
    expect(body).toContain('"reason":"stream_limit"');
    expect(body.match(/^event: done$/gm)).toHaveLength(1);
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(4096);
    expect(activeWebsiteAiStreamKeys(redis.claimed)).toHaveLength(0);
  });

  it('bounds an event flood and releases the stream with one safe terminal', async () => {
    let receiveEvents: ((events: unknown[]) => void) | undefined;
    mocks.subscribe.mockImplementation(
      async (_id, _cursor, onEvents, signal: AbortSignal | undefined) =>
        await new Promise<void>((resolve) => {
          receiveEvents = onEvents;
          signal?.addEventListener('abort', () => resolve());
        }),
    );
    const events = Array.from({ length: 8193 }, (_, index) => ({
      data: { chunkType: 'text', content: 'x' },
      id: `${index + 1}-0`,
      operationId: 'operation-1',
      stepIndex: index,
      timestamp: index,
      type: 'stream_chunk',
    }));

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '事件洪水测试' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const bodyPromise = response.text();
    for (let offset = 0; offset < events.length; offset += 256) {
      receiveEvents?.(events.slice(offset, offset + 256));
      await yieldToStreamReader();
    }
    const body = await bodyPromise;

    expect(body).toContain('"code":"STREAM_LIMIT"');
    expect(body.match(/^event: done$/gm)).toHaveLength(1);
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(1024 * 1024);
  });

  it('bounds cumulative SSE bytes while a responsive client keeps reading', async () => {
    let receiveEvents: ((events: unknown[]) => void) | undefined;
    mocks.subscribe.mockImplementation(
      async (_id, _cursor, onEvents, signal: AbortSignal | undefined) =>
        await new Promise<void>((resolve) => {
          receiveEvents = onEvents;
          signal?.addEventListener('abort', () => resolve());
        }),
    );
    const events = Array.from({ length: 140 }, (_, index) => ({
      data: { chunkType: 'text', content: 'x'.repeat(60 * 1024) },
      id: `${index + 1}-0`,
      operationId: 'operation-1',
      stepIndex: index,
      timestamp: index,
      type: 'stream_chunk',
    }));

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '累计输出上限测试' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const bodyPromise = response.text();
    for (let offset = 0; offset < events.length; offset += 2) {
      receiveEvents?.(events.slice(offset, offset + 2));
      await yieldToStreamReader();
    }
    const body = await bodyPromise;

    expect(body).toContain('"code":"STREAM_LIMIT"');
    expect(body.match(/^event: done$/gm)).toHaveLength(1);
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(8 * 1024 * 1024 + 1024);
  });

  it('keeps a normal multi-megabyte travel copy stream intact', async () => {
    const segment = '川西秋色与高原旅行建议。'.repeat(48);
    let receiveEvents: ((events: unknown[]) => void) | undefined;
    mocks.subscribe.mockImplementation(
      async (_id, _cursor, onEvents, signal: AbortSignal | undefined) =>
        await new Promise<void>((resolve) => {
          receiveEvents = onEvents;
          signal?.addEventListener('abort', () => resolve());
        }),
    );
    const events = Array.from({ length: 2048 }, (_, index) => ({
      data: { chunkType: 'text', content: segment },
      id: `${index + 1}-0`,
      operationId: 'operation-1',
      stepIndex: index,
      timestamp: index,
      type: 'stream_chunk',
    }));

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '正常长文案测试' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const bodyPromise = response.text();
    for (let offset = 0; offset < events.length; offset += 64) {
      receiveEvents?.(events.slice(offset, offset + 64));
      await yieldToStreamReader();
    }
    receiveEvents?.([
      {
        data: { reason: 'done', uiMessages: [] },
        operationId: 'operation-1',
        stepIndex: 2048,
        timestamp: 2048,
        type: 'agent_runtime_end',
      },
    ]);
    const body = await bodyPromise;

    expect(body).not.toContain('STREAM_LIMIT');
    expect(body.match(/^event: delta$/gm)).toHaveLength(2048);
    expect(body.match(/^event: done$/gm)).toHaveLength(1);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(1024 * 1024);
  });

  it('bounds an unread client queue, aborts its subscription, and releases the user slot', async () => {
    let onEvents: ((events: unknown[]) => void) | undefined;
    let subscribedSignal: AbortSignal | undefined;
    mocks.subscribe.mockImplementation(
      async (_id, _cursor, receiveEvents, signal: AbortSignal | undefined) =>
        await new Promise<void>((resolve) => {
          onEvents = receiveEvents;
          subscribedSignal = signal;
          signal?.addEventListener('abort', () => resolve());
        }),
    );
    const request = () =>
      app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ prompt: '慢客户端测试' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      });
    let retryReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    const response = await request();
    onEvents?.(
      Array.from({ length: 40 }, (_, index) => ({
        data: { chunkType: 'text', content: 'x'.repeat(8192) },
        id: `${index + 1}-0`,
        operationId: 'operation-1',
        stepIndex: index,
        timestamp: index,
        type: 'stream_chunk',
      })),
    );

    await vi.waitFor(() => expect(subscribedSignal?.aborted).toBe(true));
    const body = await response.text();
    expect(body).toContain('"code":"STREAM_BACKPRESSURE"');
    expect(body.match(/^event: done$/gm)).toHaveLength(1);

    try {
      const retry = await request();
      expect(retry.status).toBe(200);
      retryReader = retry.body!.getReader();
      await retryReader.read();
    } finally {
      await retryReader?.cancel();
    }
  });

  it('sends a heartbeat while an operation has no events', async () => {
    vi.useFakeTimers();
    mocks.subscribe.mockImplementation(
      async (_id, _cursor, _onEvents, signal) =>
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve())),
    );
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ prompt: '等待心跳' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      });
      expect(response.headers.get('cache-control')).toMatch(/no-cache/);
      expect(response.headers.get('cache-control')).toMatch(/no-transform/);
      expect(response.headers.get('x-accel-buffering')).toBe('no');
      reader = response.body!.getReader();
      await reader.read();
      let heartbeat: ReadableStreamReadResult<Uint8Array> | undefined;
      void reader.read().then((result) => {
        heartbeat = result;
      });

      await vi.advanceTimersByTimeAsync(15_000);

      expect(new TextDecoder().decode(heartbeat?.value)).toBe(': heartbeat\n\n');
    } finally {
      await reader?.cancel();
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });

  it('aborts and emits one timeout terminal after two minutes without runtime events', async () => {
    vi.useFakeTimers();
    let subscribedSignal: AbortSignal | undefined;
    mocks.subscribe.mockImplementation(
      async (_id, _cursor, _onEvents, signal) =>
        await new Promise<void>((resolve) => {
          subscribedSignal = signal;
          signal?.addEventListener('abort', () => resolve());
        }),
    );
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let retryReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ prompt: '等待超时' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      });
      reader = response.body!.getReader();
      const chunks = [new TextDecoder().decode((await reader.read()).value)];

      await vi.advanceTimersByTimeAsync(120_000);
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(new TextDecoder().decode(result.value));
      }
      const body = chunks.join('');

      expect(subscribedSignal?.aborted).toBe(true);
      expect(body).toContain('"code":"STREAM_TIMEOUT"');
      expect(body.match(/^event: done$/gm)).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);

      const retry = await app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ prompt: '超时后重试' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      });
      expect(retry.status).toBe(200);
      retryReader = retry.body!.getReader();
      await retryReader.read();
      await retryReader.cancel();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await retryReader?.cancel();
      await reader?.cancel();
      vi.useRealTimers();
    }
  });

  it('times out a non-ending subscription even when Redis refresh resolves late', async () => {
    vi.useFakeTimers();
    const claimed = new Map<string, string>();
    const lateRefresh = createDeferred<number>();
    let refreshCalls = 0;
    mocks.redisClient = {
      eval: async (...args: unknown[]) => {
        const [, , keyValue, ownerValue, ttl] = args;
        const key = String(keyValue);
        const owner = String(ownerValue);
        if (ttl !== undefined) {
          refreshCalls += 1;
          if (refreshCalls === 1) return claimed.get(key) === owner ? 1 : 0;
          return lateRefresh.promise;
        }
        if (claimed.get(key) !== owner) return 0;
        claimed.delete(key);
        return 1;
      },
      set: async (...args: unknown[]) => {
        const [keyValue, ownerValue] = args;
        const key = String(keyValue);
        if (claimed.has(key)) return null;
        claimed.set(key, String(ownerValue));
        return 'OK';
      },
    };
    let subscribedSignal: AbortSignal | undefined;
    mocks.subscribe.mockImplementation(
      async (_id, _cursor, _onEvents, signal: AbortSignal | undefined) =>
        await new Promise<void>((resolve) => {
          subscribedSignal = signal;
          signal?.addEventListener('abort', () => resolve());
        }),
    );
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ prompt: '迟到刷新测试' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      });
      reader = response.body!.getReader();
      const chunks = [new TextDecoder().decode((await reader.read()).value)];

      await vi.advanceTimersByTimeAsync(120_000);
      expect(subscribedSignal?.aborted).toBe(true);
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(new TextDecoder().decode(result.value));
      }
      const body = chunks.join('');
      expect(body).toContain('"code":"STREAM_TIMEOUT"');
      expect(body.match(/^event: done$/gm)).toHaveLength(1);
      expect(body).not.toContain(': heartbeat');
      expect(activeWebsiteAiStreamKeys(claimed)).toHaveLength(0);

      lateRefresh.resolve(1);
      await vi.runAllTicks();
      expect(activeWebsiteAiStreamKeys(claimed)).toHaveLength(0);
    } finally {
      lateRefresh.resolve(0);
      await reader?.cancel();
      vi.useRealTimers();
    }
  });

  it('continues a topic and exposes only its public conversation id', async () => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '继续上一轮', topicId: 'topic-owned' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    const body = await response.text();
    expect(response.status).toBe(200);
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '继续上一轮',
        requestIdentity: expect.stringMatching(/^website-ai:v1:[a-f0-9]{64}$/),
        topicId: 'topic-owned',
      }),
    );
    expect(body.split('\n\n')[0]).toContain('"topicId":"topic-1"');
    expect(body).not.toContain('operation-1');
    expect(body).not.toContain('assistant-1');
    expect(body).not.toContain('user-message-1');
  });

  it('passes a validated Website AI Credits limit to the trusted service boundary', async () => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ maxCredits: 12_345, prompt: '制作行程' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(mocks.start).toHaveBeenCalledWith({
      maxCredits: 12_345,
      message: '制作行程',
      requestIdentity: expect.stringMatching(/^website-ai:v1:[a-f0-9]{64}$/),
      topicId: undefined,
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid Website AI Credits limit %s',
    async (maxCredits) => {
      const response = await app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ maxCredits, prompt: '制作行程' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      });

      expect(response.status).toBe(422);
      expect(mocks.start).not.toHaveBeenCalled();
    },
  );

  it('creates a new topic when the optional topic id is blank', async () => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '首次创作', topicId: '   ' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    const body = await response.text();
    expect(response.status).toBe(200);
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '首次创作',
        requestIdentity: expect.stringMatching(/^website-ai:v1:[a-f0-9]{64}$/),
        topicId: undefined,
      }),
    );
    expect(body.split('\n\n')[0]).toContain('"topicId":"topic-1"');
  });

  it('reuses one start for the same user idempotency key and resumes from Last-Event-ID', async () => {
    mocks.start.mockResolvedValueOnce({
      assistantMessageId: 'assistant-1',
      operationId: 'operation-1',
      progressMembers: [],
      responseDelivery: 'settlement-gated-text',
      topicId: 'topic-1',
      userMessageId: 'user-message-1',
    });
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
      onEvents([
        {
          data: { chunkType: 'text', content: '可见内容' },
          id: '41-0',
          operationId: 'operation-1',
          stepIndex: 1,
          timestamp: 1,
          type: 'stream_chunk',
        },
        {
          data: { reason: 'completed', uiMessages: [] },
          id: '42-0',
          operationId: 'operation-1',
          stepIndex: 2,
          timestamp: 2,
          type: 'agent_runtime_end',
        },
      ]);
    });
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'website-ai-retry-1',
      'Origin': 'http://localhost',
    };

    const first = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '重试不应重复启动' }),
      headers,
      method: 'POST',
    });
    const firstBody = await first.text();
    const resumed = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '重试不应重复启动' }),
      headers: { ...headers, 'Last-Event-ID': '41-0' },
      method: 'POST',
    });
    await resumed.text();
    const repeatedResume = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '重试不应重复启动' }),
      headers: { ...headers, 'Last-Event-ID': '41-0' },
      method: 'POST',
    });
    await repeatedResume.text();

    expect(firstBody).toContain('id: 41-0.0');
    expect(firstBody).toContain('id: 42-0.1');
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe).toHaveBeenNthCalledWith(
      1,
      'operation-1',
      '0',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(mocks.subscribe).toHaveBeenNthCalledWith(
      2,
      'operation-1',
      '41-0',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(mocks.subscribe).toHaveBeenNthCalledWith(
      3,
      'operation-1',
      '41-0',
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('gives expanded public frames unique cursors and resumes after an individual frame', async () => {
    mocks.start.mockResolvedValueOnce({
      assistantMessageId: 'assistant-1',
      operationId: 'operation-1',
      progressMembers: [
        { id: 'agt-copy', name: '旅游文案助理' },
        { id: 'agt-image', name: '图片封面助理' },
      ],
      topicId: 'topic-1',
      userMessageId: 'user-message-1',
    });
    const completedMember = (agentId: string) => ({
      plugin: {
        apiName: 'speak',
        arguments: JSON.stringify({ agentId, instruction: 'private instruction' }),
        identifier: 'lobe-group-management',
      },
      pluginState: { status: 'completed' },
      role: 'tool',
    });
    const runtimeEvents = [
      {
        data: {
          uiMessages: [completedMember('agt-copy'), completedMember('agt-image')],
        },
        id: '41-0',
        operationId: 'operation-1',
        stepIndex: 1,
        timestamp: 1,
        type: 'step_start',
      },
      {
        data: { reason: 'completed', uiMessages: [] },
        id: '42-0',
        operationId: 'operation-1',
        stepIndex: 2,
        timestamp: 2,
        type: 'agent_runtime_end',
      },
    ];
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => onEvents(runtimeEvents));
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'website-ai-expanded-frame-retry',
      'Origin': 'http://localhost',
    };

    const first = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '复现多帧游标' }),
      headers,
      method: 'POST',
    });
    const firstBody = await first.text();
    const resumed = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '复现多帧游标' }),
      headers: { ...headers, 'Last-Event-ID': '41-0.0' },
      method: 'POST',
    });
    const resumedBody = await resumed.text();

    expect(firstBody).toContain('id: 41-0.0\nevent: status');
    expect(firstBody).toContain('id: 41-0.1\nevent: status');
    expect(firstBody).toContain('id: 42-0.0\nevent: status');
    expect(firstBody).toContain('id: 42-0.1\nevent: done');
    expect(resumed.status).toBe(200);
    expect(resumedBody).not.toContain('旅游文案助理');
    expect(resumedBody).toContain('图片封面助理');
    expect(resumedBody).toContain('id: 42-0.1\nevent: done');
    expect(mocks.subscribe).toHaveBeenNthCalledWith(
      2,
      'operation-1',
      '0',
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('reconnects after cancellation without starting generation twice', async () => {
    let subscriptions = 0;
    let firstSubscriptionReleased = false;
    mocks.subscribe.mockImplementation(async (_id, cursor, onEvents, signal) => {
      subscriptions += 1;
      if (subscriptions === 1) {
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
        firstSubscriptionReleased = true;
        return;
      }
      expect(cursor).toBe('41-0');
      onEvents([
        {
          data: { reason: 'completed', uiMessages: [] },
          operationId: 'operation-1',
          stepIndex: 2,
          timestamp: 2,
          type: 'agent_runtime_end',
        },
      ]);
    });
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'website-ai-cancel-resume-1',
      'Origin': 'http://localhost',
    };

    const initial = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '取消后重连' }),
      headers,
      method: 'POST',
    });
    const reader = initial.body!.getReader();
    await reader.read();
    await reader.cancel();
    const resumed = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '取消后重连' }),
      headers: { ...headers, 'Last-Event-ID': '41-0' },
      method: 'POST',
    });
    const resumedBody = await resumed.text();

    expect(resumed.status).toBe(200);
    expect(resumedBody.match(/^event: done$/gm)).toHaveLength(1);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    expect(firstSubscriptionReleased).toBe(true);
  });

  it('rejects reusing an idempotency key with a different request', async () => {
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'website-ai-conflict-1',
      'Origin': 'http://localhost',
    };
    const first = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '第一个请求' }),
      headers,
      method: 'POST',
    });
    await first.text();

    const conflict = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '第二个不同请求' }),
      headers,
      method: 'POST',
    });

    expect(conflict.status).toBe(409);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it('rejects reusing an idempotency key with a different Credits limit', async () => {
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'website-ai-limit-conflict-1',
      'Origin': 'http://localhost',
    };
    const first = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ maxCredits: 1000, prompt: '同一制作请求' }),
      headers,
      method: 'POST',
    });
    await first.text();

    const conflict = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ maxCredits: 2000, prompt: '同一制作请求' }),
      headers,
      method: 'POST',
    });

    expect(conflict.status).toBe(409);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it('scopes an idempotency key to the authenticated user', async () => {
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'website-ai-user-scope-1',
      'Origin': 'http://localhost',
    };
    const first = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '同一请求' }),
      headers,
      method: 'POST',
    });
    await first.text();
    mocks.getSession.mockResolvedValueOnce({ user: { id: 'user-2' } });

    const second = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '同一请求' }),
      headers,
      method: 'POST',
    });
    await second.text();

    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed retry headers before starting an operation', async () => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '非法重试头' }),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'contains spaces',
        'Last-Event-ID': 'not-a-stream-id',
        'Origin': 'http://localhost',
      },
      method: 'POST',
    });

    expect(response.status).toBe(422);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('does not start a new operation from a stale cursor without an idempotency key', async () => {
    const response = await rawApp.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '不能用旧游标启动新任务' }),
      headers: {
        'Content-Type': 'application/json',
        'Last-Event-ID': '41-0',
        'Origin': 'http://localhost',
      },
      method: 'POST',
    });

    expect(response.status).toBe(422);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('does not restart an expired idempotent operation when a cursor is supplied', async () => {
    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '已过期的重连' }),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'website-ai-expired-1',
        'Last-Event-ID': '41-0',
        'Origin': 'http://localhost',
      },
      method: 'POST',
    });

    expect(response.status).toBe(409);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('aborts the operation subscription when the client disconnects', async () => {
    vi.useFakeTimers();
    let subscribedSignal: AbortSignal | undefined;
    mocks.subscribe.mockImplementation(
      async (_id, _cursor, _onEvents, signal: AbortSignal | undefined) => {
        subscribedSignal = signal;
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
      },
    );

    try {
      const response = await app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ prompt: '断开订阅' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      });
      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel();

      expect(subscribedSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('awaits the async Redis lease lifecycle before admitting and closing a normal SSE stream', async () => {
    const claimed = new Map<string, string>();
    const acquireGate = createDeferred<void>();
    const refreshGate = createDeferred<void>();
    const releaseGate = createDeferred<void>();
    const set = vi.fn(async (...args: unknown[]) => {
      const [keyValue, ownerValue] = args;
      await acquireGate.promise;
      const key = String(keyValue);
      if (claimed.has(key)) return null;
      claimed.set(key, String(ownerValue));
      return 'OK';
    });
    const evalLease = vi.fn(async (...args: unknown[]) => {
      const [, , keyValue, ownerValue, ttl] = args;
      const key = String(keyValue);
      const owner = String(ownerValue);
      if (ttl !== undefined) {
        await refreshGate.promise;
        return claimed.get(key) === owner ? 1 : 0;
      }
      await releaseGate.promise;
      if (claimed.get(key) !== owner) return 0;
      claimed.delete(key);
      return 1;
    });
    mocks.redisClient = { eval: evalLease, set };
    const request = () =>
      app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ prompt: '异步租约正常流' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      });

    let responseSettled = false;
    const responsePromise = request().then((response) => {
      responseSettled = true;
      return response;
    });
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(responseSettled).toBe(false);

    acquireGate.resolve(undefined);
    await vi.waitFor(() => expect(evalLease).toHaveBeenCalledTimes(1));
    expect(responseSettled).toBe(false);

    refreshGate.resolve(undefined);
    const response = await responsePromise;
    expect(response.status).toBe(200);
    const bodyPromise = response.text();
    await vi.waitFor(() => expect(evalLease).toHaveBeenCalledTimes(2));

    let bodySettled = false;
    void bodyPromise.then(() => {
      bodySettled = true;
    });
    const duplicate = await request();
    expect(duplicate.status).toBe(429);
    expect(duplicate.headers.get('retry-after')).toBe('60');
    expect(bodySettled).toBe(false);
    expect(activeWebsiteAiStreamKeys(claimed)).toHaveLength(1);

    releaseGate.resolve(undefined);
    const body = await bodyPromise;
    expect(body).toContain('event: status');
    expect(body.match(/^event: done$/gm)).toHaveLength(1);
    expect(activeWebsiteAiStreamKeys(claimed)).toHaveLength(0);
  });

  it('limits one live stream per user, isolates users, and releases on disconnect', async () => {
    mocks.getSession.mockImplementation(async (headers: Headers) => ({
      user: { id: headers.get('x-test-user') ?? 'user-1' },
    }));
    mocks.findUser.mockImplementation(async (_db, userId: string) => ({
      banned: false,
      emailVerified: true,
      id: userId,
    }));
    mocks.subscribe.mockImplementation(
      async (_id, _cursor, _onEvents, signal: AbortSignal | undefined) =>
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve())),
    );
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    const request = async (userId: string) =>
      await app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ prompt: '并发槽位测试' }),
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost',
          'X-Test-User': userId,
        },
        method: 'POST',
      });

    try {
      const first = await request('user-a');
      const firstReader = first.body!.getReader();
      readers.push(firstReader);
      await firstReader.read();

      const duplicate = await request('user-a');
      const otherUser = await request('user-b');
      const otherReader = otherUser.body!.getReader();
      readers.push(otherReader);
      await otherReader.read();

      expect(duplicate.status).toBe(429);
      expect(duplicate.headers.get('retry-after')).toBe('60');
      await expect(duplicate.json()).resolves.toEqual({
        error: { code: 'TOO_MANY_REQUESTS', message: '请求过于频繁，请稍后再试。' },
      });
      expect(otherUser.status).toBe(200);

      await firstReader.cancel();
      const afterDisconnect = await request('user-a');
      expect(afterDisconnect.status).toBe(200);
      const resumedReader = afterDisconnect.body!.getReader();
      readers.push(resumedReader);
      await resumedReader.read();
    } finally {
      await Promise.all(readers.map(async (reader) => await reader.cancel().catch(() => {})));
    }
  });

  it('releases the user slot when the incoming request signal aborts', async () => {
    const claimed = new Map<string, string>();
    mocks.redisClient = {
      eval: async (...args: unknown[]) => {
        const [, , keyValue, ownerValue, ttl] = args;
        const key = String(keyValue);
        const owner = String(ownerValue);
        if (claimed.get(key) !== owner) return 0;
        if (ttl !== undefined) return 1;
        claimed.delete(key);
        return 1;
      },
      set: async (...args: unknown[]) => {
        const [keyValue, ownerValue] = args;
        const key = String(keyValue);
        if (claimed.has(key)) return null;
        claimed.set(key, String(ownerValue));
        return 'OK';
      },
    };
    let subscribedSignal: AbortSignal | undefined;
    mocks.subscribe.mockImplementation(
      async (_id, _cursor, _onEvents, signal: AbortSignal | undefined) =>
        await new Promise<void>((resolve) => {
          subscribedSignal = signal;
          signal?.addEventListener('abort', () => resolve());
        }),
    );
    const requestController = new AbortController();
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    const request = async (signal?: AbortSignal) =>
      await app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ prompt: '请求中断测试' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
        signal,
      });

    try {
      const first = await request(requestController.signal);
      const firstReader = first.body!.getReader();
      readers.push(firstReader);
      await firstReader.read();

      requestController.abort();
      await vi.waitFor(() => expect(subscribedSignal?.aborted).toBe(true));
      await expect(
        Promise.race([
          firstReader.closed.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
        ]),
      ).resolves.toBe(true);
      expect(activeWebsiteAiStreamKeys(claimed)).toHaveLength(0);

      const afterAbort = await request();
      expect(afterAbort.status).toBe(200);
      const resumedReader = afterAbort.body!.getReader();
      readers.push(resumedReader);
      await resumedReader.read();
    } finally {
      await Promise.all(readers.map(async (reader) => await reader.cancel().catch(() => {})));
    }
  });

  it.each([
    ['normal done', 'completed'],
    ['generation failure', 'error'],
    ['runtime interruption', 'interrupted'],
    ['incomplete subscription', undefined],
  ])('releases the user slot after %s', async (_label, reason) => {
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
      if (reason) {
        onEvents([
          {
            data: { reason, uiMessages: [] },
            operationId: 'operation-1',
            stepIndex: 1,
            timestamp: 1,
            type: 'agent_runtime_end',
          },
        ]);
      }
    });
    const request = async () =>
      await app.request('http://localhost/api/website-ai/chat', {
        body: JSON.stringify({ prompt: '终态释放测试' }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      });

    const first = await request();
    const firstBody = await first.text();
    const second = await request();
    const secondBody = await second.text();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.match(/^event: done$/gm)).toHaveLength(1);
    expect(secondBody.match(/^event: done$/gm)).toHaveLength(1);
  });

  it('releases the user slot when generation startup fails', async () => {
    mocks.start
      .mockRejectedValueOnce(
        new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '[BALANCE_EMPTY] Credits 余额不足，请充值后重试。',
        }),
      )
      .mockResolvedValueOnce({
        assistantMessageId: 'assistant-2',
        operationId: 'operation-2',
        progressMembers: [],
        topicId: 'topic-2',
        userMessageId: 'user-message-2',
      });

    const failed = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '启动失败' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const retry = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '启动失败后重试' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(failed.status).toBe(412);
    expect(retry.status).toBe(200);
    expect((await retry.text()).match(/^event: done$/gm)).toHaveLength(1);
  });

  it('returns HTTP 429 with a retry hint when customer admission is limited', async () => {
    mocks.start.mockRejectedValue(
      new TRPCError({ code: 'TOO_MANY_REQUESTS', message: '请求过于频繁' }),
    );

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '再做一份行程' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toEqual({
      error: { code: 'TOO_MANY_REQUESTS', message: '请求过于频繁' },
    });
  });

  it('keeps model usage and routing details outside the homepage SSE contract', async () => {
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
      onEvents([
        {
          data: {
            reason: 'completed',
            uiMessages: [
              {
                model: 'private-model',
                provider: 'private-provider',
                usage: {
                  apiKey: 'private-key',
                  cost: 0.002,
                  totalInputTokens: 10,
                  totalOutputTokens: 5,
                  totalTokens: 15,
                },
              },
            ],
          },
          operationId: 'operation-1',
          stepIndex: 1,
          timestamp: 1,
          type: 'agent_runtime_end',
        },
      ]);
    });

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '用量契约' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const body = await response.text();

    expect(body).not.toMatch(
      /event: usage|private-model|private-provider|private-key|apiKey|totalInputTokens|totalOutputTokens|totalTokens|cost/,
    );
    expect(body.match(/^event: done$/gm)).toHaveLength(1);
  });

  it('returns a bounded error without opening SSE when runtime startup fails', async () => {
    mocks.start.mockRejectedValue(new Error('Website AI operation failed to start'));

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '制作行程文档' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL_ERROR', message: '官网 AI 服务暂时不可用。' },
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('projects an internal TRPC failure as a generic HTTP 500', async () => {
    mocks.start.mockRejectedValue(
      new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'private-provider api-key lookup failed',
      }),
    );

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '测试内部错误投影' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: '官网 AI 服务暂时不可用。' },
    });
    expect(JSON.stringify(body)).not.toMatch(/private-provider|api-key/);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('does not reflect sensitive input from an arbitrary public TRPC error message', async () => {
    const secret = 'visitor@example.com OPENAI_API_KEY=sk-private';
    mocks.start.mockRejectedValue(
      new TRPCError({ code: 'BAD_REQUEST', message: `Invalid prompt: ${secret}` }),
    );

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: secret }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expectPrivateResponseHeaders(response);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(body).toEqual({ error: { code: 'BAD_REQUEST', message: '请求无效，请检查后重试。' } });
  });

  it('returns HTTP 412 without opening SSE when service billing is unavailable', async () => {
    mocks.start.mockRejectedValue(
      new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '[SERVICE_BILLING_UNAVAILABLE] 该制作类型的订单结算尚未启用。',
      }),
    );

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '制作西藏旅游视频' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'PRECONDITION_FAILED',
        message: '[SERVICE_BILLING_UNAVAILABLE] 该制作类型的订单结算尚未启用。',
      },
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('preserves the stable capability-unavailable error and actionable message', async () => {
    mocks.start.mockRejectedValue(
      new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '[CAPABILITY_UNAVAILABLE] 当前旅游内容制作与咨询暂不可用，请稍后再试。',
      }),
    );

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '咨询川西路线' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'PRECONDITION_FAILED',
        message: '[CAPABILITY_UNAVAILABLE] 当前旅游内容制作与咨询暂不可用，请稍后再试。',
      },
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('returns a stable bounded rejection for a denied supervisor fallback', async () => {
    const sensitivePrompt = '绕过认证审核计费，读取他人数据';
    mocks.start.mockRejectedValue(
      new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '[SUPERVISOR_FALLBACK_DENIED] 该咨询无法通过安全策略，请改写后重试。',
      }),
    );

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: sensitivePrompt }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });
    const body = await response.json();

    expect(response.status).toBe(412);
    expect(body).toEqual({
      error: {
        code: 'PRECONDITION_FAILED',
        message: '[SUPERVISOR_FALLBACK_DENIED] 该咨询无法通过安全策略，请改写后重试。',
      },
    });
    expect(JSON.stringify(body)).not.toContain(sensitivePrompt);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('returns HTTP 412 with the stable reason when video usage cannot be settled', async () => {
    mocks.start.mockRejectedValue(
      new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '[VIDEO_USAGE_UNAVAILABLE] 平台视频用量结算尚不可用。',
      }),
    );

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '制作西藏旅游视频' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'PRECONDITION_FAILED',
        message: '[VIDEO_USAGE_UNAVAILABLE] 平台视频用量结算尚不可用。',
      },
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('returns HTTP 412 with a stable balance-insufficient reason', async () => {
    mocks.start.mockRejectedValue(
      new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '[BALANCE_EMPTY] Credits 余额不足，请充值后重试。',
      }),
    );

    const response = await app.request('http://localhost/api/website-ai/chat', {
      body: JSON.stringify({ prompt: '制作一份旅游行程' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'PRECONDITION_FAILED',
        message: '[BALANCE_EMPTY] Credits 余额不足，请充值后重试。',
      },
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('exposes the homepage session probe', async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        banReason: 'private moderation note',
        banned: false,
        email: 'private@example.com',
        id: 'user-1',
        name: '公开昵称',
        role: 'admin',
      },
    });
    mocks.getCapabilities.mockResolvedValue({
      copy: { available: true },
      document: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
      image: {
        available: false,
        internalGroupId: 'group-internal',
        internalOperationId: 'operation-internal',
        internalTopicId: 'topic-internal',
        model: 'private-image-model',
        provider: 'private-provider',
        reasonCode: 'CAPABILITY_UNAVAILABLE',
      },
      video: {
        available: false,
        internalMemberId: 'member-internal',
        model: 'private-video-model',
        provider: 'private-provider',
        reasonCode: 'CAPABILITY_UNAVAILABLE',
      },
    });
    const response = await app.request('/api/website-ai/session');
    const body = await response.json();
    expectPrivateResponseHeaders(response);
    expect(body).toEqual({
      accountFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      authenticated: true,
      capabilities: {
        copy: { available: true },
        document: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
        image: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
        submission: { available: true },
        video: { available: false, reasonCode: 'CAPABILITY_UNAVAILABLE' },
      },
      user: { name: '公开昵称' },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /amountFen|CNY|provider|model|private@example|user-1|admin|banReason|internalGroup|internalMember|internalOperation|internalTopic/,
    );
    expect(mocks.getCapabilities).toHaveBeenCalledWith(expect.anything(), 'user-1');

    const originalFingerprint = body.accountFingerprint;
    const repeatedResponse = await app.request('/api/website-ai/session');
    expect((await repeatedResponse.json()).accountFingerprint).toBe(originalFingerprint);

    mocks.getSession.mockResolvedValue({ user: { id: 'user-2', name: '公开昵称' } });
    mocks.findUser.mockResolvedValue({
      banned: false,
      emailVerified: true,
      id: 'user-2',
    });
    const switchedResponse = await app.request('/api/website-ai/session');
    const switchedBody = await switchedResponse.json();
    expect(switchedBody.accountFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(switchedBody.accountFingerprint).not.toBe(originalFingerprint);
    expect(JSON.stringify(switchedBody)).not.toContain('user-2');
  });

  it('projects platform capability lookup failures without leaking routing details', async () => {
    mocks.getCapabilities.mockRejectedValue(
      new Error('private-provider/private-model credential lookup failed'),
    );

    const response = await app.request('/api/website-ai/session');

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL_ERROR', message: '官网 AI 服务暂时不可用。' },
    });
  });

  it('returns only the customer-facing projection of an owned generation task', async () => {
    const response = await app.request('http://localhost/api/website-ai/generation/status', {
      body: JSON.stringify({ taskId: 'travel-task-1' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expectPrivateResponseHeaders(response);
    const body = await response.json();
    expect(body).toEqual({
      artifacts: [
        {
          id: 'generation-1',
          type: 'image',
        },
      ],
      id: 'travel-task-1',
      status: 'succeeded',
      type: 'image',
    });
    expect(JSON.stringify(body)).not.toMatch(/secret-provider|orderId|owner|prompt/);
    expect(JSON.stringify(body)).not.toMatch(/internal artifact payload|mimeType/);
    expect(mocks.reconcile).toHaveBeenCalledWith('travel-task-1');
  });

  it('does not expose a generation artifact URL outside website public resource routes', async () => {
    mocks.reconcile.mockResolvedValue({
      artifacts: [
        {
          documentId: 'document-1',
          name: '内部文档',
          type: 'document',
          url: '/lobehub/works/private?token=secret#preview',
        },
      ],
      id: 'travel-task-1',
      input: { prompt: 'private prompt' },
      owner: { groupId: 'group-1', userId: 'user-1' },
      status: 'succeeded',
      type: 'document',
    });

    const response = await app.request('http://localhost/api/website-ai/generation/status', {
      body: JSON.stringify({ taskId: 'travel-task-1' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      artifacts: [{ id: 'document-1', type: 'document', url: '/lobehub/page/document-1' }],
      id: 'travel-task-1',
      status: 'succeeded',
      type: 'document',
    });
  });

  it("does not reveal another customer's generation task", async () => {
    mocks.findTravelTask.mockResolvedValueOnce(undefined);
    const response = await app.request('http://localhost/api/website-ai/generation/status', {
      body: JSON.stringify({ taskId: 'other-task' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', message: '未找到对应的生成任务。' },
    });
  });

  it('keeps a guessed task id uniformly invisible across two users', async () => {
    mocks.findUser.mockImplementation(async (_db, userId: string) => ({
      banned: false,
      emailVerified: true,
      id: userId,
    }));
    mocks.findGroup.mockImplementation(async (userId: string) => ({
      id: `group-${userId}`,
      visibility: 'private',
    }));
    mocks.findTravelTask.mockImplementation(async (userId: string, taskId: string) =>
      userId === 'user-b' && taskId === 'task-owned-by-b'
        ? { groupId: 'group-user-b', id: taskId, userId: 'user-b' }
        : undefined,
    );
    mocks.reconcile.mockImplementation(async (taskId: string) => ({
      artifacts: [{ generationId: 'artifact-b', type: 'image', url: '/f/artifact-b' }],
      id: taskId,
      input: { prompt: 'private prompt b' },
      owner: { groupId: 'group-user-b', userId: 'user-b' },
      provider: 'private-provider',
      status: 'succeeded',
      type: 'image',
    }));
    const requestStatus = (taskId: string) =>
      app.request('http://localhost/api/website-ai/generation/status', {
        body: JSON.stringify({ taskId }),
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
        method: 'POST',
      });

    mocks.getSession.mockResolvedValue({ user: { id: 'user-a' } });
    const hidden = await requestStatus('task-owned-by-b');
    const nonexistent = await requestStatus('not-a-task');
    const hiddenBody = await hidden.json();
    const nonexistentBody = await nonexistent.json();

    expect(hidden.status).toBe(404);
    expect(hiddenBody).toEqual(nonexistentBody);
    expect(mocks.reconcile).not.toHaveBeenCalled();

    mocks.getSession.mockResolvedValue({ user: { id: 'user-b' } });
    const visible = await requestStatus('task-owned-by-b');
    const visibleBody = await visible.json();

    expect(mocks.findGroup).toHaveBeenLastCalledWith('user-b', 'default-travel-service-group');
    expect(mocks.findTravelTask).toHaveBeenLastCalledWith('user-b', 'task-owned-by-b');
    expect(mocks.reconcile).toHaveBeenCalledWith('task-owned-by-b');
    expect(visible.status).toBe(200);
    expect(visibleBody).toEqual({
      artifacts: [{ id: 'artifact-b', type: 'image' }],
      id: 'task-owned-by-b',
      status: 'succeeded',
      type: 'image',
    });
    expect(JSON.stringify(visibleBody)).not.toMatch(/user-b|group-user-b|private prompt|provider/);
  });

  it('rejects a same-user task outside the current private website AI group before reconcile', async () => {
    mocks.findTravelTask.mockResolvedValue({
      groupId: 'other-private-group',
      id: 'same-user-other-group-task',
      userId: 'user-1',
    });

    const response = await app.request('http://localhost/api/website-ai/generation/status', {
      body: JSON.stringify({ taskId: 'same-user-other-group-task' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', message: '未找到对应的生成任务。' },
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('withholds artifacts if the website AI group stops being private during reconciliation', async () => {
    let groupLookupCount = 0;
    mocks.findGroup.mockImplementation(async () => {
      groupLookupCount += 1;
      return groupLookupCount === 1 ? { id: 'group-1', visibility: 'private' } : undefined;
    });

    const response = await app.request('http://localhost/api/website-ai/generation/status', {
      body: JSON.stringify({ taskId: 'travel-task-1' }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(mocks.reconcile).toHaveBeenCalledWith('travel-task-1');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', message: '未找到对应的生成任务。' },
    });
  });

  it('rejects forged operation and topic identifiers as status request fields', async () => {
    const response = await app.request('http://localhost/api/website-ai/generation/status', {
      body: JSON.stringify({
        operationId: 'other-user-operation',
        taskId: 'travel-task-1',
        topicId: 'other-user-topic',
      }),
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      method: 'POST',
    });

    expect(response.status).toBe(422);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('keeps the real homepage session and generation-status response shapes stable', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', name: '公开昵称' } });
    const client = createContractClient();

    await expect(client.getSession()).resolves.toEqual({
      authenticated: true,
      capabilities: {
        copy: { available: false },
        document: { available: false },
        image: { available: false },
        submission: { available: false },
        video: { available: false },
      },
      user: { name: '公开昵称' },
    });
    await expect(client.getGeneration('travel-task-1')).resolves.toEqual({
      artifacts: [{ id: 'generation-1', type: 'image' }],
      id: 'travel-task-1',
      status: 'succeeded',
      type: 'image',
    });
  });

  it('does not expose internal generation failure fields through status polling', async () => {
    mocks.reconcile.mockResolvedValue({
      artifacts: [],
      code: 'GENERATION_FAILED',
      id: 'travel-task-1',
      input: { prompt: 'private prompt' },
      message: 'provider secret-key failed',
      owner: { groupId: 'group-1', userId: 'user-1' },
      provider: 'private-provider',
      status: 'failed',
      type: 'image',
    });
    const client = createContractClient();

    await expect(client.getGeneration('travel-task-1')).resolves.toEqual({
      artifacts: [],
      id: 'travel-task-1',
      status: 'failed',
      type: 'image',
    });
  });

  it.each([
    {
      error: new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '[BALANCE_EMPTY] Credits 余额不足，请充值后重试。',
      }),
      expected: {
        code: 'PRECONDITION_FAILED',
        message: '官网 AI 服务暂时不可用，请稍后再试。',
        status: 412,
      },
      label: '余额不足',
    },
    {
      error: new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '[VIDEO_USAGE_UNAVAILABLE] 平台视频用量结算尚不可用。',
      }),
      expected: {
        code: 'PRECONDITION_FAILED',
        message: '官网 AI 服务暂时不可用，请稍后再试。',
        status: 412,
      },
      label: '视频不可用',
    },
    {
      error: new TRPCError({ code: 'TOO_MANY_REQUESTS', message: '请求过于频繁' }),
      expected: {
        code: 'TOO_MANY_REQUESTS',
        message: '请求过于频繁，请稍后再试。',
        status: 429,
      },
      label: '限流',
    },
  ])('保持官网客户端的$label错误 code、status 和文案', async ({ error, expected }) => {
    mocks.start.mockRejectedValue(error);
    const client = createContractClient();

    await expect(
      client.submit({ prompt: '协议错误用例', signal: undefined, topicId: undefined }, () => {}),
    ).rejects.toMatchObject(expected);
  });

  it('maps an unavailable account to the homepage login contract', async () => {
    mocks.getSession.mockResolvedValue(null);
    const client = createContractClient();

    await expect(
      client.submit({ prompt: '账号不可用', signal: undefined, topicId: undefined }, () => {}),
    ).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      message: '请先登录统一账号后继续。',
      status: 401,
    });
  });

  it('delivers copy, image and document fields in the homepage event order', async () => {
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
      onEvents([
        {
          data: { chunkType: 'text', content: '桂林旅游文案' },
          id: '1-0',
          operationId: 'operation-secret',
          stepIndex: 1,
          timestamp: 1,
          type: 'stream_chunk',
        },
        {
          data: {
            reason: 'completed',
            uiMessages: [
              {
                imageList: [{ id: 'image-1', name: '封面图', provider: 'private-provider' }],
                model: 'private-model',
                usage: { cost: 99, totalTokens: 999 },
                works: [{ id: 'document-1', title: '桂林行程', type: 'document' }],
              },
            ],
          },
          id: '2-0',
          operationId: 'operation-secret',
          stepIndex: 2,
          timestamp: 2,
          type: 'agent_runtime_end',
        },
      ]);
    });
    const client = createContractClient();
    const display = createHomepageAiDisplayState();
    const events: unknown[] = [];

    await client.submit(
      { prompt: '同时制作文案、图片和文档', signal: undefined, topicId: undefined },
      (event: unknown) => {
        events.push(event);
        display.apply(event);
      },
    );

    expect(events).toEqual([
      { message: '已接收任务', status: 'queued', topicId: 'topic-1', type: 'status' },
      { text: '桂林旅游文案', type: 'delta' },
      {
        id: 'document-1',
        kind: 'document',
        title: '桂林行程',
        type: 'artifact',
        url: '/lobehub/page/document-1',
      },
      {
        id: 'image-1',
        kind: 'image',
        title: '封面图',
        type: 'artifact',
        url: '/f/image-1',
      },
      { status: 'completed', type: 'status' },
      { reason: 'completed', type: 'done' },
    ]);
    expect(display.snapshot()).toMatchObject({
      answer: '桂林旅游文案',
      terminal: 'completed',
    });
    expect(JSON.stringify(events)).not.toMatch(
      /cost|model|operation-secret|private-provider|totalTokens|usage/,
    );
  });

  it('delivers interruption as one public error followed by one done event', async () => {
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
      onEvents([
        {
          data: { reason: 'interrupted', reasonDetail: 'private abort detail', uiMessages: [] },
          operationId: 'operation-secret',
          stepIndex: 1,
          timestamp: 1,
          type: 'agent_runtime_end',
        },
      ]);
    });
    const client = createContractClient();
    const display = createHomepageAiDisplayState();
    const events: unknown[] = [];

    await client.submit(
      { prompt: '中断用例', signal: undefined, topicId: undefined },
      (event: unknown) => {
        events.push(event);
        display.apply(event);
      },
    );

    expect(events).toEqual([
      { message: '已接收任务', status: 'queued', topicId: 'topic-1', type: 'status' },
      { code: 'INTERRUPTED', message: '本次 AI 任务未完成，请稍后重试。', type: 'error' },
      { reason: 'interrupted', type: 'done' },
    ]);
    expect(display.snapshot().terminal).toBe('failed');
    expect(events.filter((event: any) => event.type === 'done')).toHaveLength(1);
    expect(JSON.stringify(events)).not.toMatch(/operation-secret|private abort detail/);
  });

  it('runs the real homepage client request through the Hono route contract', async () => {
    mocks.subscribe.mockImplementation(async (_id, _cursor, onEvents) => {
      onEvents([
        {
          data: {
            chunkType: 'tools_calling',
            toolsCalling: [
              {
                apiName: 'speak',
                arguments: JSON.stringify({
                  agentId: 'agt-copy',
                  instruction: '内部调度提示词',
                }),
                id: 'call-copy',
                identifier: 'lobe-group-management',
                type: 'default',
              },
            ],
          },
          operationId: 'operation-1',
          stepIndex: 1,
          timestamp: 1,
          type: 'stream_chunk',
        },
        {
          data: {
            uiMessages: [
              {
                plugin: {
                  apiName: 'speak',
                  arguments: JSON.stringify({
                    agentId: 'agt-copy',
                    instruction: '内部调度提示词',
                  }),
                  identifier: 'lobe-group-management',
                },
                pluginState: { status: 'completed' },
                role: 'tool',
              },
            ],
          },
          operationId: 'operation-1',
          stepIndex: 2,
          timestamp: 2,
          type: 'step_start',
        },
        {
          data: { chunkType: 'text', content: '群主最终汇总' },
          operationId: 'operation-1',
          stepIndex: 2,
          timestamp: 3,
          type: 'stream_chunk',
        },
        {
          data: {
            reason: 'completed',
            uiMessages: [
              {
                works: [{ id: 'work-1', title: '桂林旅游文案', type: 'document' }],
              },
            ],
          },
          operationId: 'operation-1',
          stepIndex: 3,
          timestamp: 4,
          type: 'agent_runtime_end',
        },
      ]);
    });
    const client = createContractClient();
    const events: unknown[] = [];

    await client.submit(
      { prompt: '制作桂林行程', signal: undefined, topicId: undefined },
      (event: unknown) => events.push(event),
    );

    expect(events).toEqual([
      { message: '已接收任务', status: 'queued', topicId: 'topic-1', type: 'status' },
      {
        member: '旅游文案助理',
        message: '旅游文案助理正在执行……',
        phase: 'started',
        status: 'member_progress',
        type: 'status',
      },
      {
        member: '旅游文案助理',
        message: '旅游文案助理已完成。',
        phase: 'completed',
        status: 'member_progress',
        type: 'status',
      },
      { text: '群主最终汇总', type: 'delta' },
      {
        id: 'work-1',
        kind: 'document',
        title: '桂林旅游文案',
        type: 'artifact',
        url: '/lobehub/page/work-1',
      },
      { status: 'completed', type: 'status' },
      { reason: 'completed', type: 'done' },
    ]);
    expect(JSON.stringify(events)).not.toContain('agt-copy');
    expect(JSON.stringify(events)).not.toContain('内部调度提示词');
  });
});
