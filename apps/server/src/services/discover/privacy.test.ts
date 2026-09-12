// @vitest-environment node
import { expect, it, vi } from 'vitest';

import { MarketService } from '../market';
import { DiscoverService } from './index';

const { calls } = vi.hoisted(() => ({ calls: vi.fn() }));
vi.mock('@/envs/app', () => ({ appEnv: { TELEMETRY_DISABLED: true } }));
vi.mock('@/server/modules/AssistantStore');
vi.mock('@/server/modules/PluginStore');
vi.mock('@lobehub/market-sdk', () => ({
  MarketSDK: vi.fn().mockImplementation(() => ({
    agents: { createEvent: calls, increaseInstallCount: calls },
    agentGroups: { createAgentGroupEvent: calls, increaseInstallCount: calls },
    plugins: { createEvent: calls, reportCall: calls, reportInstallation: calls },
  })),
}));

it('blocks community reports from both service entry points', async () => {
  const discover = new DiscoverService();
  const market = new MarketService();
  await discover.reportPluginInstallation({ identifier: 'test', version: '1', success: true });
  await discover.reportCall({ identifier: 'test' } as any);
  await discover.createPluginEvent({ identifier: 'test', event: 'click' });
  await discover.createAgentEvent({ identifier: 'test', event: 'click' });
  await discover.increaseAgentInstallCount('test');
  await discover.createGroupAgentEvent({ identifier: 'test', event: 'click' });
  await discover.increaseGroupAgentInstallCount('test');
  await market.reportPluginInstallation({ identifier: 'test' });
  await market.reportPluginCall({ identifier: 'test' });
  await market.createPluginEvent({ identifier: 'test' });
  await market.increaseAgentInstallCount('test');
  await market.createAgentEvent({ identifier: 'test' });
  expect(calls).not.toHaveBeenCalled();
});
