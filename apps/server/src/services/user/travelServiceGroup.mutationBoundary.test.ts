import { GROUP_SUPERVISOR } from '@lobechat/builtin-agents';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  isDefaultTravelServiceGroupClientId,
  isRequiredTravelServiceAgentIdentity,
  TRAVEL_SPECIALIST_TEMPLATES,
} from './travelServiceGroup';

describe('travel service group mutation identity helpers', () => {
  it('recognizes only the default travel service group client id', () => {
    expect(isDefaultTravelServiceGroupClientId(DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID)).toBe(true);
    expect(isDefaultTravelServiceGroupClientId('another-group')).toBe(false);
    expect(isDefaultTravelServiceGroupClientId(null)).toBe(false);
  });

  it('recognizes the builtin supervisor and every required specialist', () => {
    expect(isRequiredTravelServiceAgentIdentity({ slug: GROUP_SUPERVISOR.slug })).toBe(true);
    for (const { clientId } of TRAVEL_SPECIALIST_TEMPLATES) {
      expect(isRequiredTravelServiceAgentIdentity({ clientId })).toBe(true);
    }
    expect(
      isRequiredTravelServiceAgentIdentity({ clientId: 'user-agent', slug: 'user-agent' }),
    ).toBe(false);
  });
});
