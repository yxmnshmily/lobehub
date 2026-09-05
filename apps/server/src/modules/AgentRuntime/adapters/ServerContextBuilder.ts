import type {
  ContextBuilder,
  ContextBuildInput,
  ContextBuildOutput,
} from '@lobechat/agent-runtime';
import { isDeepSeekV4FamilyModel } from '@lobechat/model-runtime';
import type { OperationToolDispatchPolicy } from '@lobechat/types';

import type { RuntimeExecutorContext } from '../context';
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

    return {
      messages: result.processedMessages,
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
