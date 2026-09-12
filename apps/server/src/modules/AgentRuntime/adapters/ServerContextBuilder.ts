import type {
  ContextBuilder,
  ContextBuildInput,
  ContextBuildOutput,
} from '@lobechat/agent-runtime';
import { getModelPropertyWithFallback, isDeepSeekV4FamilyModel } from '@lobechat/model-runtime';
import type { OperationToolDispatchPolicy } from '@lobechat/types';

import type { RuntimeExecutorContext } from '../context';
import { log } from '../executorHelpers';
import { fitGroupContextBudget } from './groupContextBudget';
import { buildServerCallLlmContext } from './serverCallLlmContextBuilder';
import { resolveServerCallLlmTooling } from './serverCallLlmTooling';

export class ServerContextBuilder implements ContextBuilder {
  constructor(private readonly ctx: RuntimeExecutorContext) {}

  async build(input: ContextBuildInput): Promise<ContextBuildOutput> {
    const dispatchPolicy = input.state.metadata?.toolDispatchPolicy as
      OperationToolDispatchPolicy | undefined;
    const dispatchCursor = dispatchPolicy?.cursor ?? 0;
    const dispatchStep = dispatchPolicy?.steps[dispatchCursor];
    const dispatchFinished =
      dispatchPolicy?.finishAfterSteps === true && dispatchCursor >= dispatchPolicy.steps.length;
    const tooling = resolveServerCallLlmTooling(
      this.ctx,
      input.state,
      dispatchStep
        ? [dispatchStep.toolName]
        : dispatchFinished
          ? []
          : input.payload.allowedToolNames,
    );
    const result = await buildServerCallLlmContext({
      ctx: this.ctx,
      llmPayload: input.payload,
      model: input.model,
      provider: input.provider,
      state: input.state,
      tooling,
    });

    let messages = result.processedMessages;
    if (
      this.ctx.platformManagedExecutionAuthorized &&
      !this.ctx.agentShareVisitor &&
      input.state.metadata?.groupId &&
      !input.state.metadata?.threadId
    ) {
      const contextWindow = await getModelPropertyWithFallback<number | undefined>(
        input.model,
        'contextWindowTokens',
        input.provider,
      );
      const fitted = fitGroupContextBudget(
        messages,
        tooling.resolved.tools ?? [],
        contextWindow ?? 128_000,
        (input.payload.messages ?? input.state.messages)
          .filter((message) => message.role === 'user' && Boolean(message.id))
          .map((message) => message.id),
        (result.resolvedExtendParams as { max_tokens?: number } | undefined)?.max_tokens,
        result.messageSourceIds,
      );
      messages = fitted.messages;
      if (fitted.removedMessages) {
        log(
          '[%s] group context budget omitted %d historical messages; originals retained',
          this.ctx.operationId,
          fitted.removedMessages,
        );
      }
    }

    return {
      messages,
      modelParameters: dispatchStep
        ? {
            ...(result.resolvedExtendParams as object),
            ...(isDeepSeekV4FamilyModel(input.model) && { thinking: { type: 'disabled' } }),
            tool_choice: 'required',
          }
        : result.resolvedExtendParams,
      preserveThinking: result.preserveThinkingForPayload,
      replayAssistantReasoning: result.shouldReplayAssistantReasoning,
      resolvedTools: tooling.resolved,
    };
  }
}
