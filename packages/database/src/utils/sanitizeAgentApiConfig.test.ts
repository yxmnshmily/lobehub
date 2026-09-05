import { describe, expect, it } from 'vitest';

import { sanitizeAgentApiConfig } from './sanitizeAgentApiConfig';

describe('sanitizeAgentApiConfig', () => {
  it('strips the server-owned model runtime mode from generic writes', () => {
    expect(
      sanitizeAgentApiConfig({
        executionTarget: 'none',
        modelRuntimeMode: 'platform-managed',
        modelSelectionPolicy: 'fixed',
      }),
    ).toEqual({
      executionTarget: 'none',
      modelSelectionPolicy: 'fixed',
    });
  });

  it('strips runtime mode while still sanitizing heterogeneous API credentials', () => {
    expect(
      sanitizeAgentApiConfig({
        heterogeneousProvider: {
          apiConfig: {
            apiKey: 'must-not-persist',
            model: 'claude-primary',
            providerId: 'anthropic',
          },
          authMode: 'api',
          type: 'claude-code',
        },
        modelRuntimeMode: 'platform-managed',
      } as never),
    ).toEqual({
      heterogeneousProvider: {
        apiConfig: { model: 'claude-primary', providerId: 'anthropic' },
        authMode: 'api',
        type: 'claude-code',
      },
    });
  });
});
