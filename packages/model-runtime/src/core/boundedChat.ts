import type { ChatMethodOptions, ChatStreamPayload } from '../types';

/** Model capacities resolved from the trusted server catalog, never browser request fields. */
export interface BoundedChatModelLimits {
  contextWindowTokens: number;
  maxOutput: number;
}

export interface PreparedBoundedChat {
  chat: (payload: ChatStreamPayload, options?: ChatMethodOptions) => Promise<Response>;
  inputTokenLimit: number;
  maxOutputTokens: number;
}

/**
 * Prepare one immutable request on the selected native runtime. Billing reserves the
 * model's complete input/output capacities, not an approximate tokenizer count or a
 * vendor-specific interpretation of max_tokens (which may exclude reasoning).
 */
export const prepareBoundedChat = (params: {
  chat: PreparedBoundedChat['chat'];
  limits: BoundedChatModelLimits;
  maxOutputTokens: number;
  /** Native adapter's verified total generation cap, including reasoning and any overshoot. */
  outputTokenLimit?: number;
  payload: ChatStreamPayload;
}): PreparedBoundedChat => {
  const { maxOutputTokens, payload } = params;
  const { contextWindowTokens, maxOutput } = params.limits ?? {};
  if (
    !Number.isSafeInteger(contextWindowTokens) ||
    contextWindowTokens <= 0 ||
    !Number.isSafeInteger(maxOutput) ||
    maxOutput <= 0 ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens <= 0 ||
    maxOutputTokens > maxOutput
  )
    throw new Error('所选模型缺少有效的上下文或输出额度配置。');

  const snapshot = structuredClone({ ...payload, max_tokens: maxOutputTokens });
  // Preserve native Responses/thinking/tool support and configured model mappings.
  // Only one completion is authorized per reservation.
  Object.assign(snapshot, { n: 1 });
  let executed = false;
  return Object.freeze({
    chat: async (_input: ChatStreamPayload, options?: ChatMethodOptions) => {
      if (executed) throw new Error('Bounded chat was already executed');
      executed = true;
      return params.chat(snapshot, options);
    },
    inputTokenLimit: contextWindowTokens,
    // Some native APIs report the answer cap separately from reasoning tokens.
    // The complete context ceiling includes both; never underquote hidden thinking.
    maxOutputTokens: params.outputTokenLimit ?? Math.max(contextWindowTokens, maxOutput),
  });
};
