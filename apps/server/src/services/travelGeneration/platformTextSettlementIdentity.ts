export const PLATFORM_TEXT_SETTLEMENT_GENERATION_TYPE = 'agent-runtime-text-step' as const;

/** One canonical identity shared by text reservation and customer settlement lookup. */
export const buildPlatformTextSettlementIdentity = (taskId: string) => ({
  generationId: `travel-generation:${taskId}:step:0:call_llm`,
  generationType: PLATFORM_TEXT_SETTLEMENT_GENERATION_TYPE,
});
