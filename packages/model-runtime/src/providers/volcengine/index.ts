import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatStreamPayload } from '../../types';
import { createVolcengineImage } from './createImage';
import { createVolcengineVideo } from './video/createVideo';
import { handleVolcengineVideoWebhook } from './video/handleCreateVideoWebhook';

const isVolcengineReasoningEffortModel = (model: string) => {
  const normalizedModel = model.toLowerCase();

  return normalizedModel.includes('deepseek-v4') || normalizedModel.includes('glm-5-2');
};

/**
 * `thinking.type` values Ark accepts. The runtime's own union is wider — it also
 * carries `adaptive`, which is Anthropic's "let the model decide" and which Ark
 * rejects outright:
 *
 *     The parameter `type` specified in the request are not valid:
 *     invalid value adaptive.
 *
 * That reached here from a real caller, not a hypothetical one: `/api/v1/anthropic`
 * relays an Anthropic client's request body, and Claude Code sends
 * `thinking: {type: 'adaptive'}` on every request regardless of which model it
 * has been pointed at. Forwarding whatever arrived turned that into a 400 on
 * every turn.
 *
 * Anything outside this set is dropped rather than translated. Omitting the
 * field leaves Ark on the model's own default, which is what "let the model
 * decide" asks for — and unlike a guessed mapping it cannot fail the request.
 */
const ARK_THINKING_TYPES = new Set(['enabled', 'disabled']);

const arkThinking = (thinking: any) =>
  ARK_THINKING_TYPES.has(thinking?.type) ? thinking : undefined;

const resolveVolcengineReasoningParams = (
  model: string,
  thinking: any,
  reasoning_effort: any,
  isResponses = false,
) => {
  let targetThinking = arkThinking(thinking);
  let targetReasoningEffort = reasoning_effort;

  if (isVolcengineReasoningEffortModel(model)) {
    if (thinking?.type === 'disabled') {
      targetThinking = { type: 'disabled' };
      targetReasoningEffort = 'minimal';
    } else if (thinking?.type === 'enabled' || reasoning_effort) {
      targetThinking = { type: 'enabled' };
      let effort = reasoning_effort || 'high';
      if (isResponses && effort === 'max') {
        effort = 'high';
      }
      targetReasoningEffort = effort;
    }
  }

  return {
    thinking: targetThinking,
    reasoning_effort: targetReasoningEffort,
  };
};

const VolcengineRuntime = createOpenAICompatibleRuntime({
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  chatCompletion: {
    handlePayload: (payload) => {
      const { enabledSearch, thinking, reasoning_effort, ...rest } = payload;

      if (enabledSearch) {
        return {
          ...rest,
          apiMode: 'responses',
          enabledSearch,
        } as ChatStreamPayload;
      }

      const params = resolveVolcengineReasoningParams(
        payload.model,
        thinking,
        reasoning_effort,
        false,
      );

      return {
        ...rest,
        ...(params.thinking?.type && { thinking: { type: params.thinking.type } }),
        ...(params.reasoning_effort && { reasoning_effort: params.reasoning_effort }),
      } as any;
    },
  },
  createImage: createVolcengineImage,
  createVideo: createVolcengineVideo,
  debug: {
    chatCompletion: () => process.env.DEBUG_VOLCENGINE_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_VOLCENGINE_RESPONSES === '1',
  },
  handleCreateVideoWebhook: handleVolcengineVideoWebhook,
  provider: ModelProvider.Volcengine,
  responses: {
    handlePayload: (payload) => {
      const { enabledSearch, tools, thinking, reasoning_effort, ...rest } = payload;
      const params = resolveVolcengineReasoningParams(
        payload.model,
        thinking,
        reasoning_effort,
        true,
      );

      const volcengineTools = enabledSearch
        ? [
            ...(tools || []),
            {
              function: {
                sources: ['douyin', 'moji', 'toutiao'], // Additional search sources (Douyin Baike, Moji Weather, Toutiao, etc.)
              },
              type: 'web_search',
            },
          ]
        : tools;

      return {
        ...rest,
        tools: volcengineTools,
        ...(params.thinking?.type && { thinking: { type: params.thinking.type } }),
        ...(params.reasoning_effort && { reasoning_effort: params.reasoning_effort }),
      } as any;
    },
    prepareRequest: (payload) => {
      // These OpenAI/Chat Completions fields are outside Ark's Responses request
      // contract. Server-side bounded group turns can add both before this
      // provider-specific request is finalized.
      const {
        n: _n,
        safety_identifier: _safetyIdentifier,
        ...arkPayload
      } = payload as typeof payload & {
        n?: number;
      };

      return { payload: arkPayload };
    },
  },
});

// Keep saved catalog aliases compatible with Ark's published inference IDs.
// Verified against the authenticated /api/v3/models catalog on 2026-09-08.
const DEFAULT_MODEL_ID_MAPPING = {
  'doubao-seed-2.1-pro': 'doubao-seed-2-1-pro-260628',
  'doubao-seed-2.1-turbo': 'doubao-seed-2-1-turbo-260628',
};

// The native Seed 2.1 endpoint created in Ark is Responses-only. Match both
// the saved catalog aliases and the published wire IDs so ordinary group-agent
// turns cannot accidentally fall back to /chat/completions and fail with 404.
const NATIVE_SEED_2_1_RESPONSE_MODELS = [/^doubao-seed-2(?:\.1|-1)-(?:turbo|pro)(?:-260628)?$/];

export class LobeVolcengineAI extends VolcengineRuntime {
  constructor(options: ConstructorParameters<typeof VolcengineRuntime>[0] = {}) {
    const useNativeAliases =
      !options.baseURL?.trim() ||
      /^https:\/\/ark\.cn-beijing\.volces\.com\/api\/v3\/?$/.test(options.baseURL.trim());
    const chatCompletion =
      useNativeAliases && !options.chatCompletion?.useResponseModels
        ? {
            ...options.chatCompletion,
            useResponseModels: NATIVE_SEED_2_1_RESPONSE_MODELS,
          }
        : options.chatCompletion;
    super({
      ...options,
      ...(chatCompletion ? { chatCompletion } : {}),
      modelIdMapping: {
        ...(useNativeAliases ? DEFAULT_MODEL_ID_MAPPING : {}),
        ...options.modelIdMapping,
      },
    });
  }
}
