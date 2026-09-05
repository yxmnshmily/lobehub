import { describe, expect, it } from 'vitest';

describe('travel service group script imports', () => {
  it('loads the production initialization module in the script runtime graph', async () => {
    const service = await import('../../apps/server/src/services/user/travelServiceGroup');

    expect(service.DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID).toBe('default-travel-service-group');
    expect(service.initDefaultTravelServiceGroup).toBeTypeOf('function');
  }, 30_000);
});
