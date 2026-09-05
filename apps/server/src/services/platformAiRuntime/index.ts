import type {
  GenerateObjectPayload,
  GenerateObjectRouteIdentity,
  ModelRuntime,
  PreparedGenerateObjectBounded,
} from '@lobechat/model-runtime';
import { computeChatCost } from '@lobechat/model-runtime';
import type { Pricing } from 'model-bank';

import { RbacModel } from '@/database/models/rbac';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import {
  initModelRuntimeFromDB,
  type ModelRuntimeCredentialOptions,
} from '@/server/modules/ModelRuntime';
import { filterHiddenProviderModels } from '@/utils/aiProvider';

export const PLATFORM_MANAGED_AI_RUNTIME = 'platform-managed' as const;

interface PlatformBoundedTextModel {
  maxOutputTokens: number;
  provider: string;
  route: Readonly<GenerateObjectRouteIdentity>;
}

/** Deliberately empty until a versioned model passes the bounded-provider contract suite. */
const PLATFORM_BOUNDED_TEXT_MODEL_ALLOWLIST: readonly PlatformBoundedTextModel[] = Object.freeze(
  [],
);

const hasRequiredTextPricing = (pricing: Pricing) => {
  const unitNames = new Set(pricing.units?.map(({ name }) => name));
  return unitNames.has('textInput') && unitNames.has('textOutput');
};

const computeMaximumTextCredits = (
  pricing: Pricing,
  inputTokens: number,
  outputTokens: number,
) => {
  if (!hasRequiredTextPricing(pricing)) return;
  try {
    const result = computeChatCost(pricing, {
      inputCacheMissTokens: inputTokens,
      inputTextTokens: inputTokens,
      outputTextTokens: outputTokens,
      totalInputTokens: inputTokens,
      totalOutputTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    });
    if (
      result.issues.length > 0 ||
      !Number.isSafeInteger(result.totalCredits) ||
      result.totalCredits <= 0
    ) {
      return;
    }
    return result.totalCredits;
  } catch {
    return;
  }
};

const computeAffordableOutputTokens = (params: {
  inputTokens: number;
  maxCredits: number;
  pricing: Pricing;
  staticMaxOutputTokens: number;
}) => {
  if (
    !Number.isSafeInteger(params.inputTokens) ||
    params.inputTokens < 0 ||
    !Number.isSafeInteger(params.maxCredits) ||
    params.maxCredits <= 0 ||
    !Number.isSafeInteger(params.staticMaxOutputTokens) ||
    params.staticMaxOutputTokens <= 0
  ) {
    return;
  }

  let affordable = 0;
  let lower = 1;
  let upper = params.staticMaxOutputTokens;
  while (lower <= upper) {
    const candidate = Math.floor((lower + upper) / 2);
    const credits = computeMaximumTextCredits(params.pricing, params.inputTokens, candidate);
    if (credits !== undefined && credits <= params.maxCredits) {
      affordable = candidate;
      lower = candidate + 1;
    } else {
      upper = candidate - 1;
    }
  }
  return affordable > 0 ? affordable : undefined;
};

/**
 * Non-serializable marker for trusted, in-process callers. It deliberately
 * carries no owner id: every process boundary resolves and re-validates the
 * configured owner instead of trusting data supplied by a browser or task.
 */
const PLATFORM_AI_RUNTIME_MARKER = Symbol('platform-ai-runtime');
const PLATFORM_AI_RUNTIME_CAPABILITY = Symbol('platform-ai-runtime-capability');

export interface PlatformAiRuntimeCapability {
  maxCredits?: number;
}

type PlatformAiRuntimeMarked = {
  [PLATFORM_AI_RUNTIME_CAPABILITY]?: Readonly<PlatformAiRuntimeCapability>;
  [PLATFORM_AI_RUNTIME_MARKER]?: typeof PLATFORM_MANAGED_AI_RUNTIME;
};

export const markPlatformAiRuntime = <T extends object>(
  context: T,
  capability: PlatformAiRuntimeCapability = {},
): T & PlatformAiRuntimeMarked => {
  if (
    capability.maxCredits !== undefined &&
    (!Number.isSafeInteger(capability.maxCredits) || capability.maxCredits <= 0)
  ) {
    throw new TypeError('maxCredits must be a positive safe integer');
  }
  Object.defineProperty(context, PLATFORM_AI_RUNTIME_MARKER, {
    configurable: false,
    // Enumerable symbols survive tRPC's in-process context spreading, while
    // JSON.stringify still ignores symbol keys at process/browser boundaries.
    enumerable: true,
    value: PLATFORM_MANAGED_AI_RUNTIME,
    writable: false,
  });
  Object.defineProperty(context, PLATFORM_AI_RUNTIME_CAPABILITY, {
    configurable: false,
    enumerable: true,
    value: Object.freeze({ ...capability }),
    writable: false,
  });
  return context;
};

export const getPlatformAiRuntimeCapability = (
  context: unknown,
): Readonly<PlatformAiRuntimeCapability> | undefined =>
  context && typeof context === 'object'
    ? (context as PlatformAiRuntimeMarked)[PLATFORM_AI_RUNTIME_CAPABILITY]
    : undefined;

export const getPlatformAiRuntimeMarker = (
  context: unknown,
): typeof PLATFORM_MANAGED_AI_RUNTIME | undefined =>
  context && typeof context === 'object'
    ? (context as PlatformAiRuntimeMarked)[PLATFORM_AI_RUNTIME_MARKER]
    : undefined;

export class PlatformCredentialResolver {
  private ownerPromise?: Promise<string>;

  constructor(private readonly db: LobeChatDatabase) {}

  resolveOwnerId(): Promise<string> {
    this.ownerPromise ??= this.resolveAndValidateOwnerId();
    return this.ownerPromise;
  }

  private async resolveAndValidateOwnerId(): Promise<string> {
    const ownerId = process.env.TRAVEL_PLATFORM_CREDENTIAL_OWNER_ID;
    if (!ownerId || ownerId.trim() !== ownerId) {
      throw new Error('Platform AI credential owner is not configured');
    }

    const owner = await UserModel.findById(this.db, ownerId);
    const banIsActive =
      owner?.banned === true &&
      (!owner.banExpires || new Date(owner.banExpires).getTime() > Date.now());
    const isSuperAdmin = owner
      ? await new RbacModel(this.db, ownerId).hasGlobalRole('super_admin')
      : false;

    if (!owner || banIsActive || !isSuperAdmin) {
      throw new Error('Platform AI credential owner is unavailable');
    }

    return ownerId;
  }
}

/** Server-only entry point for platform-managed model calls. */
export class PlatformAiRuntime {
  private readonly credentialResolver: PlatformCredentialResolver;

  constructor(
    private readonly db: LobeChatDatabase,
    credentialResolver?: PlatformCredentialResolver,
    private readonly boundedTextModels: readonly PlatformBoundedTextModel[] =
      PLATFORM_BOUNDED_TEXT_MODEL_ALLOWLIST,
  ) {
    this.credentialResolver = credentialResolver ?? new PlatformCredentialResolver(db);
  }

  async getCredentialOptions(): Promise<ModelRuntimeCredentialOptions> {
    return { credentialOwnerId: await this.credentialResolver.resolveOwnerId() };
  }

  async listEnabledModels(type: 'image' | 'video'): Promise<{
    providers: Array<{ id: string; models: Array<{ id: string }> }>;
  }> {
    const ownerId = await this.credentialResolver.resolveOwnerId();
    const [{ aiModelRouter }, { aiProviderRouter }] = await Promise.all([
      import('@/server/routers/lambda/aiModel'),
      import('@/server/routers/lambda/aiProvider'),
    ]);
    const callerContext = { userId: ownerId };
    const runtimeState = await aiProviderRouter
      .createCaller(callerContext)
      .getAiProviderRuntimeState({});
    const enabledProviders =
      type === 'image'
        ? runtimeState.enabledImageAiProviders
        : runtimeState.enabledVideoAiProviders;
    const providers = await Promise.all(
      enabledProviders.map(async (provider) => {
        const models = await aiModelRouter.createCaller(callerContext).getAiProviderModelList({
          enabled: true,
          id: provider.id,
          type,
        });
        return {
          id: provider.id,
          models: filterHiddenProviderModels(
            models,
            provider.id,
            runtimeState.hiddenBuiltinModels,
          ).map((model) => ({ id: model.id })),
        };
      }),
    );

    return { providers: providers.filter((provider) => provider.models.length > 0) };
  }

  async init(params: {
    actorUserId: string;
    provider: string;
    workspaceId?: string;
  }): Promise<ModelRuntime> {
    return initModelRuntimeFromDB(
      this.db,
      params.actorUserId,
      params.provider,
      params.workspaceId,
      await this.getCredentialOptions(),
    );
  }

  async prepareGenerateObjectBounded(params: {
    actorUserId: string;
    payload: GenerateObjectPayload;
    pricing: Pricing;
    provider: string;
    /** Credits still available to this exact provider call, never the request's original ceiling. */
    remainingCredits: number;
    workspaceId?: string;
  }): Promise<PreparedGenerateObjectBounded> {
    const allowlisted = this.boundedTextModels.find(
      (item) => item.provider === params.provider && item.route.model === params.payload.model,
    );
    if (!allowlisted) {
      throw new Error('Platform bounded text generation is unavailable');
    }

    const initialMaxOutputTokens = computeAffordableOutputTokens({
      inputTokens: 0,
      maxCredits: params.remainingCredits,
      pricing: params.pricing,
      staticMaxOutputTokens: allowlisted.maxOutputTokens,
    });
    if (!initialMaxOutputTokens) {
      throw new Error('Platform bounded text generation has no affordable output token');
    }

    const runtime = await this.init({
      actorUserId: params.actorUserId,
      provider: params.provider,
      workspaceId: params.workspaceId,
    });
    let prepared = await runtime.prepareGenerateObjectBounded(params.payload, {
      maxOutputTokens: initialMaxOutputTokens,
      route: allowlisted.route,
    });
    const finalMaxOutputTokens = computeAffordableOutputTokens({
      inputTokens: prepared.envelope.inputTokens,
      maxCredits: params.remainingCredits,
      pricing: params.pricing,
      staticMaxOutputTokens: initialMaxOutputTokens,
    });
    if (!finalMaxOutputTokens) {
      throw new Error('Platform bounded text generation has no affordable output token');
    }
    if (finalMaxOutputTokens < initialMaxOutputTokens) {
      prepared = await runtime.prepareGenerateObjectBounded(params.payload, {
        maxOutputTokens: finalMaxOutputTokens,
        route: allowlisted.route,
      });
    }
    const exactMaximumCredits = computeMaximumTextCredits(
      params.pricing,
      prepared.envelope.inputTokens,
      prepared.envelope.maxOutputTokens,
    );
    if (
      prepared.envelope.maxOutputTokens !== finalMaxOutputTokens ||
      exactMaximumCredits === undefined ||
      exactMaximumCredits > params.remainingCredits ||
      prepared.envelope.maximumCredits > params.remainingCredits
    ) {
      throw new Error('Platform bounded text generation exceeds the Credits ceiling');
    }
    return prepared;
  }
}
