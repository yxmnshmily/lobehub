import { describe, expect, it } from 'vitest';

import {
  buildPlatformTextSettlementIdentity,
  PLATFORM_TEXT_SETTLEMENT_GENERATION_TYPE,
} from './platformTextSettlementIdentity';

describe('platform text settlement identity', () => {
  it.each(['copy-task', 'document-task'])(
    'uses the canonical text step identity for %s',
    (taskId) => {
      expect(buildPlatformTextSettlementIdentity(taskId)).toEqual({
        generationId: `travel-generation:${taskId}:step:0:call_llm`,
        generationType: 'agent-runtime-text-step',
      });
      expect(PLATFORM_TEXT_SETTLEMENT_GENERATION_TYPE).toBe('agent-runtime-text-step');
    },
  );
});
