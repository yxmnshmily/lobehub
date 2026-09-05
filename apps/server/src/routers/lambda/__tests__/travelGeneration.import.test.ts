import { describe, expect, it } from 'vitest';

describe('travel generation module graph', () => {
  it('initializes the real router and image runtime modules without a dependency cycle', async () => {
    const [{ travelGenerationRouter }, { imageGenerationRuntime }] = await Promise.all([
      import('../travelGeneration'),
      import('@/server/services/toolExecution/serverRuntimes/imageGeneration'),
    ]);

    expect(travelGenerationRouter).toBeDefined();
    expect(imageGenerationRuntime.factory).toBeTypeOf('function');
  }, 30_000);
});
