export const PLATFORM_IMAGE_SETTLEMENT_GENERATION_TYPE = 'platform-image-generation' as const;

/** One canonical identity shared by reservation, settlement recovery, and artifact access. */
export const buildPlatformImageSettlementIdentity = (generationId: string) => ({
  generationId,
  generationType: PLATFORM_IMAGE_SETTLEMENT_GENERATION_TYPE,
});
