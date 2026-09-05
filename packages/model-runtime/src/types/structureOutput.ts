import type { ModelUsage } from '@lobechat/types';

import type { ChatCompletionTool, ChatStreamPayload } from './chat';
import type { ModelPricingContext } from './pricing';

interface GenerateObjectMessage {
  content: string;
  name?: string;
  role: 'user' | 'system' | 'assistant';
}

export interface GenerateObjectSchema {
  description?: string;
  name: string;
  schema: {
    additionalProperties?: boolean;
    properties: Record<string, any>;
    required?: string[];
    type: 'object';
  };
  strict?: boolean;
}

export interface GenerateObjectPayload {
  messages: GenerateObjectMessage[];
  model: string;
  reasoning_effort?: ChatStreamPayload['reasoning_effort'];
  responseApi?: boolean;
  schema?: GenerateObjectSchema;
  thinking?: ChatStreamPayload['thinking'];
  tools?: ChatCompletionTool[];
}

export interface GenerateObjectOptions {
  /**
   * response headers
   */
  headers?: Record<string, any>;

  /** Free-form context passed to hooks (e.g. billing, routing). */
  metadata?: Record<string, unknown>;

  onUsage?: (usage: ModelUsage) => void | Promise<void>;

  /** Request-scoped pricing context for model-bank pricing lookups. */
  pricingContext?: ModelPricingContext;

  signal?: AbortSignal;
  /**
   * Structured tracing config consumed by tracing hooks (e.g.
   * `llm_generation_tracing`). Loosely typed here so the runtime stays
   * tracing-agnostic; callers should import `TracingOptions` from
   * `@lobechat/llm-generation-tracing` for the strongly-typed shape.
   */
  tracing?: Record<string, unknown>;

  /**
   * userId for the GenerateObject
   */
  user?: string;
}

/** Exact, non-secret route provenance for a bounded provider call. */
export interface GenerateObjectRouteIdentity {
  apiType: string;
  channelId: string;
  model: string;
  providerId: string;
  routerId: string;
}

export interface GenerateObjectBoundedOptions extends GenerateObjectOptions {
  /** Provider-enforced ceiling covering every generated token, including reasoning. */
  maxOutputTokens: number;
  /** Server-selected route. Implementations must reject rather than remap it. */
  route: GenerateObjectRouteIdentity;
}

export interface GenerateObjectBoundedEnvelope {
  inputTokens: number;
  /** Integer platform Credits reserved for the worst allowed input/output usage. */
  maximumCredits: number;
  maxOutputTokens: number;
  route: Readonly<GenerateObjectRouteIdentity>;
}

export interface GenerateObjectBoundedResult<T = unknown> {
  output: T;
  usage: ModelUsage;
}

/**
 * A prepared provider request. Execution is deliberately closure-based so callers cannot
 * rebuild or substitute the request after the authoritative token count is obtained.
 */
export interface PreparedGenerateObjectBounded<T = unknown> {
  readonly envelope: Readonly<GenerateObjectBoundedEnvelope>;
  execute: () => Promise<GenerateObjectBoundedResult<T>>;
}
