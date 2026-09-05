// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiProviderModel } from '@/database/models/aiProvider';

import { initModelRuntimeFromDB } from './index';

const mocks = vi.hoisted(() => ({
  createLLMGenerationTracingHook: vi.fn(() => ({ onStart: vi.fn() })),
  ensureFreshOAuthToken: vi.fn(async ({ keyVaults }) => keyVaults),
  getAiProviderById: vi.fn(async () => ({
    keyVaults: { oauthAccessToken: 'owner-access', oauthRefreshToken: 'owner-token' },
  })),
  getBusinessModelRuntimeHooks: vi.fn(() => ({ onEnd: vi.fn() })),
}));

vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: vi.fn().mockImplementation(() => ({
    getAiProviderById: mocks.getAiProviderById,
  })),
}));
vi.mock('@/server/services/oauthDeviceFlow/refresh', () => ({
  ensureFreshOAuthToken: mocks.ensureFreshOAuthToken,
}));
vi.mock('@/business/server/model-runtime', () => ({
  getBusinessModelRuntimeHooks: mocks.getBusinessModelRuntimeHooks,
}));
vi.mock('@/server/services/llmGenerationTracing/hook', () => ({
  createLLMGenerationTracingHook: mocks.createLLMGenerationTracingHook,
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { getUserKeyVaults: vi.fn(async () => ({})) },
}));

describe('initModelRuntimeFromDB credential principal separation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the existing actor-owned behavior when no internal option is supplied', async () => {
    await initModelRuntimeFromDB({} as any, 'customer', 'deepseek', 'workspace-1');

    expect(AiProviderModel).toHaveBeenCalledWith({}, 'customer', 'workspace-1');
    expect(mocks.getBusinessModelRuntimeHooks).toHaveBeenCalledWith(
      'customer',
      'deepseek',
      'workspace-1',
    );
  });

  it('reads provider vaults from the owner while billing and tracing stay on the customer', async () => {
    await initModelRuntimeFromDB({} as any, 'customer', 'deepseek', 'workspace-1', {
      credentialOwnerId: 'platform-admin',
    });

    expect(AiProviderModel).toHaveBeenCalledWith({}, 'platform-admin', undefined);
    expect(mocks.getBusinessModelRuntimeHooks).toHaveBeenCalledWith(
      'customer',
      'deepseek',
      'workspace-1',
    );
    expect(mocks.createLLMGenerationTracingHook).toHaveBeenCalledWith(
      'customer',
      'deepseek',
      'workspace-1',
    );
  });

  it('refreshes OAuth on the credential owner rather than the customer', async () => {
    await initModelRuntimeFromDB({} as any, 'customer', 'supergrok', 'workspace-1', {
      credentialOwnerId: 'platform-admin',
    });

    expect(mocks.ensureFreshOAuthToken).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'supergrok',
        userId: 'platform-admin',
        workspaceId: undefined,
      }),
    );
  });
});
