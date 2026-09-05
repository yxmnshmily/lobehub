import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RbacModel } from '@/database/models/rbac';
import { UserModel } from '@/database/models/user';

import {
  getPlatformAiRuntimeCapability,
  getPlatformAiRuntimeMarker,
  markPlatformAiRuntime,
  PLATFORM_MANAGED_AI_RUNTIME,
  PlatformAiRuntime,
  PlatformCredentialResolver,
} from './index';

const platformCatalogMocks = vi.hoisted(() => ({
  getAiProviderModelList: vi.fn(),
  getAiProviderRuntimeState: vi.fn(),
  modelCreateCaller: vi.fn(),
  providerCreateCaller: vi.fn(),
}));
const modelRuntimeMocks = vi.hoisted(() => ({ initModelRuntimeFromDB: vi.fn() }));

vi.mock('@/database/models/rbac', () => ({ RbacModel: vi.fn() }));
vi.mock('@/database/models/user', () => ({
  UserModel: { findById: vi.fn() },
}));
vi.mock('@/server/routers/lambda/aiModel', () => ({
  aiModelRouter: { createCaller: platformCatalogMocks.modelCreateCaller },
}));
vi.mock('@/server/routers/lambda/aiProvider', () => ({
  aiProviderRouter: { createCaller: platformCatalogMocks.providerCreateCaller },
}));
vi.mock('@/server/modules/ModelRuntime', () => modelRuntimeMocks);

describe('PlatformCredentialResolver', () => {
  const hasGlobalRole = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TRAVEL_PLATFORM_CREDENTIAL_OWNER_ID', 'platform-admin');
    vi.mocked(RbacModel).mockImplementation(() => ({ hasGlobalRole }) as any);
    vi.mocked(UserModel.findById).mockResolvedValue({ banned: false, id: 'platform-admin' } as any);
    hasGlobalRole.mockResolvedValue(true);
    platformCatalogMocks.modelCreateCaller.mockReturnValue({
      getAiProviderModelList: platformCatalogMocks.getAiProviderModelList,
    });
    platformCatalogMocks.providerCreateCaller.mockReturnValue({
      getAiProviderRuntimeState: platformCatalogMocks.getAiProviderRuntimeState,
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('fails closed when no explicit credential owner is configured', async () => {
    vi.stubEnv('TRAVEL_PLATFORM_CREDENTIAL_OWNER_ID', '');

    await expect(new PlatformCredentialResolver({} as any).resolveOwnerId()).rejects.toThrow(
      'Platform AI credential owner is not configured',
    );
  });

  it('rejects a missing, banned, or non-admin owner', async () => {
    vi.mocked(UserModel.findById).mockResolvedValueOnce(undefined);
    await expect(new PlatformCredentialResolver({} as any).resolveOwnerId()).rejects.toThrow(
      'Platform AI credential owner is unavailable',
    );

    vi.mocked(UserModel.findById).mockResolvedValueOnce({
      banned: true,
      banExpires: null,
      id: 'platform-admin',
    } as any);
    await expect(new PlatformCredentialResolver({} as any).resolveOwnerId()).rejects.toThrow(
      'Platform AI credential owner is unavailable',
    );

    vi.mocked(UserModel.findById).mockResolvedValueOnce({
      banned: false,
      id: 'platform-admin',
    } as any);
    hasGlobalRole.mockResolvedValueOnce(false);
    await expect(new PlatformCredentialResolver({} as any).resolveOwnerId()).rejects.toThrow(
      'Platform AI credential owner is unavailable',
    );
  });

  it('returns only a validated active global super_admin', async () => {
    await expect(new PlatformCredentialResolver({} as any).resolveOwnerId()).resolves.toBe(
      'platform-admin',
    );
    expect(hasGlobalRole).toHaveBeenCalledWith('super_admin');
  });

  it('reads the managed model catalog as the validated owner, never the customer', async () => {
    platformCatalogMocks.getAiProviderRuntimeState.mockResolvedValue({
      enabledImageAiProviders: [{ id: 'volcengine' }],
      enabledVideoAiProviders: [],
      hiddenBuiltinModels: [{ id: 'hidden-image', providerId: 'volcengine' }],
    });
    platformCatalogMocks.getAiProviderModelList.mockResolvedValue([
      { id: 'hidden-image' },
      { id: 'doubao-seedream-5-0-260128' },
    ]);

    const catalog = await new (await import('./index')).PlatformAiRuntime(
      {} as any,
    ).listEnabledModels('image');

    expect(platformCatalogMocks.providerCreateCaller).toHaveBeenCalledWith({
      userId: 'platform-admin',
    });
    expect(platformCatalogMocks.modelCreateCaller).toHaveBeenCalledWith({
      userId: 'platform-admin',
    });
    expect(catalog).toEqual({
      providers: [{ id: 'volcengine', models: [{ id: 'doubao-seedream-5-0-260128' }] }],
    });
  });
});

describe('platform AI runtime marker', () => {
  it('uses a server-owned symbol and never accepts a serializable owner id', () => {
    const clientPayload = {
      credentialOwnerId: 'attacker',
      platformAiRuntime: true,
    };
    expect(getPlatformAiRuntimeMarker(clientPayload)).toBeUndefined();

    const trustedContext = markPlatformAiRuntime({ userId: 'customer' });
    expect(getPlatformAiRuntimeMarker(trustedContext)).toBe(PLATFORM_MANAGED_AI_RUNTIME);
    expect(getPlatformAiRuntimeMarker({ ...trustedContext })).toBe(PLATFORM_MANAGED_AI_RUNTIME);
    expect(JSON.stringify(trustedContext)).toBe('{"userId":"customer"}');
  });

  it('carries a validated Credits maximum only in the non-serializable server capability', () => {
    const trustedContext = markPlatformAiRuntime(
      { userId: 'customer', workspaceId: 'workspace-1' },
      { maxCredits: 4321 },
    );

    expect(getPlatformAiRuntimeCapability(trustedContext)).toEqual({ maxCredits: 4321 });
    expect(getPlatformAiRuntimeCapability({ ...trustedContext })).toEqual({ maxCredits: 4321 });
    expect(JSON.stringify(trustedContext)).toBe(
      '{"userId":"customer","workspaceId":"workspace-1"}',
    );
    expect(
      getPlatformAiRuntimeCapability({ maxCredits: 999_999, platformAiRuntime: true }),
    ).toBeUndefined();
    expect(() => markPlatformAiRuntime({}, { maxCredits: 0 })).toThrow(TypeError);
    expect(() => markPlatformAiRuntime({}, { maxCredits: 1.5 })).toThrow(TypeError);
  });
});

describe('bounded platform text generation', () => {
  const route = {
    apiType: 'anthropic',
    channelId: 'platform-channel',
    model: 'claude-versioned',
    providerId: 'anthropic',
    routerId: 'platform-router',
  };
  const pricing = {
    currency: 'USD' as const,
    units: [
      { name: 'textInput' as const, rate: 1, strategy: 'fixed' as const, unit: 'millionTokens' as const },
      {
        name: 'textOutput' as const,
        rate: 2,
        strategy: 'fixed' as const,
        unit: 'millionTokens' as const,
      },
    ],
  };
  const payload = {
    messages: [{ content: 'Write travel copy', role: 'user' as const }],
    model: route.model,
    schema: { name: 'travel_copy', schema: { properties: {}, type: 'object' } },
  };

  it('keeps the empty model allowlist closed before credential or runtime initialization', async () => {
    const resolveOwnerId = vi.fn().mockResolvedValue('platform-admin');
    const runtime = new PlatformAiRuntime({} as any, { resolveOwnerId } as any);

    await expect(
      (runtime as any).prepareGenerateObjectBounded({
        actorUserId: 'customer',
        remainingCredits: 256,
        payload,
        pricing,
        provider: 'anthropic',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toThrow('Platform bounded text generation is unavailable');

    expect(resolveOwnerId).not.toHaveBeenCalled();
    expect(modelRuntimeMocks.initModelRuntimeFromDB).not.toHaveBeenCalled();
  });

  it('fails before runtime initialization when exact pricing cannot produce one output token', async () => {
    const prepareGenerateObjectBounded = vi.fn();
    modelRuntimeMocks.initModelRuntimeFromDB.mockResolvedValue({ prepareGenerateObjectBounded });
    const runtime = new PlatformAiRuntime(
      {} as any,
      { resolveOwnerId: vi.fn().mockResolvedValue('platform-admin') } as any,
      [{ maxOutputTokens: 64, provider: 'anthropic', route }],
    );

    await expect(
      runtime.prepareGenerateObjectBounded({
        actorUserId: 'customer',
        remainingCredits: 1,
        payload,
        pricing: {
          currency: 'USD',
          units: [
            {
              name: 'textOutput',
              rate: 2,
              strategy: 'fixed',
              unit: 'millionTokens',
            },
          ],
        },
        provider: 'anthropic',
      }),
    ).rejects.toThrow('Platform bounded text generation has no affordable output token');

    expect(modelRuntimeMocks.initModelRuntimeFromDB).not.toHaveBeenCalled();
    expect(prepareGenerateObjectBounded).not.toHaveBeenCalled();
  });

  it('passes the minimum of the Credits cap and static hard cap into the exact provider route', async () => {
    const execute = vi.fn().mockResolvedValue({
      output: { content: 'bounded copy' },
      usage: {
        cost: 0.0001,
        totalInputTokens: 10,
        totalOutputTokens: 40,
        totalTokens: 50,
      },
    });
    const prepareGenerateObjectBounded = vi.fn(async (_payload, options) => ({
      envelope: {
        inputTokens: 10,
        maximumCredits: options.maxOutputTokens * 2 + 10,
        maxOutputTokens: options.maxOutputTokens,
        route,
      },
      execute,
    }));
    modelRuntimeMocks.initModelRuntimeFromDB.mockResolvedValue({ prepareGenerateObjectBounded });
    const runtime = new PlatformAiRuntime(
      {} as any,
      { resolveOwnerId: vi.fn().mockResolvedValue('platform-admin') } as any,
      [{ maxOutputTokens: 64, provider: 'anthropic', route }],
    );

    const prepared = await runtime.prepareGenerateObjectBounded({
      actorUserId: 'customer',
      remainingCredits: 100,
      payload,
      pricing,
      provider: 'anthropic',
      workspaceId: 'workspace-1',
    });

    expect(prepareGenerateObjectBounded).toHaveBeenNthCalledWith(1, payload, {
      maxOutputTokens: 50,
      route,
    });
    expect(prepareGenerateObjectBounded).toHaveBeenNthCalledWith(2, payload, {
      maxOutputTokens: 45,
      route,
    });
    expect(prepared.envelope.maxOutputTokens).toBe(45);
    await expect(prepared.execute()).resolves.toMatchObject({ output: { content: 'bounded copy' } });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('keeps the static output ceiling when Credits can afford the full route cap', async () => {
    const prepareGenerateObjectBounded = vi.fn(async (_payload, options) => ({
      envelope: {
        inputTokens: 10,
        maximumCredits: options.maxOutputTokens * 2 + 10,
        maxOutputTokens: options.maxOutputTokens,
        route,
      },
      execute: vi.fn(),
    }));
    modelRuntimeMocks.initModelRuntimeFromDB.mockResolvedValue({ prepareGenerateObjectBounded });
    const runtime = new PlatformAiRuntime(
      {} as any,
      { resolveOwnerId: vi.fn().mockResolvedValue('platform-admin') } as any,
      [{ maxOutputTokens: 64, provider: 'anthropic', route }],
    );

    const prepared = await runtime.prepareGenerateObjectBounded({
      actorUserId: 'customer',
      remainingCredits: 1000,
      payload,
      pricing,
      provider: 'anthropic',
    });

    expect(prepareGenerateObjectBounded).toHaveBeenCalledOnce();
    expect(prepareGenerateObjectBounded).toHaveBeenCalledWith(payload, {
      maxOutputTokens: 64,
      route,
    });
    expect(prepared.envelope.maxOutputTokens).toBe(64);
  });
});
