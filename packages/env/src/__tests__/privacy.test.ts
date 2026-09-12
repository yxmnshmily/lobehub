import { afterEach, expect, it, vi } from 'vitest';

import { getAnalyticsConfig } from '../analytics';
import { getLangfuseConfig } from '../langfuse';

afterEach(() => vi.unstubAllEnvs());

it.each([undefined, '1'])('blocks analytics and chat tracing when privacy is %s', (value) => {
  vi.stubEnv('TELEMETRY_DISABLED', value);
  for (const key of [
    'POSTHOG_KEY',
    'PLAUSIBLE_DOMAIN',
    'UMAMI_WEBSITE_ID',
    'CLARITY_PROJECT_ID',
    'GOOGLE_ANALYTICS_MEASUREMENT_ID',
    'X_ADS_PIXEL_ID',
    'REACT_SCAN_MONITOR_API_KEY',
  ]) {
    vi.stubEnv(key, 'test-configured');
  }
  vi.stubEnv('ENABLE_VERCEL_ANALYTICS', '1');
  vi.stubEnv('ENABLE_LANGFUSE', '1');
  const config = getAnalyticsConfig();
  expect(config.ENABLED_POSTHOG_ANALYTICS).toBe(false);
  expect(config.ENABLED_PLAUSIBLE_ANALYTICS).toBe(false);
  expect(config.ENABLED_UMAMI_ANALYTICS).toBe(false);
  expect(config.ENABLED_CLARITY_ANALYTICS).toBe(false);
  expect(config.ENABLE_GOOGLE_ANALYTICS).toBe(false);
  expect(config.ENABLED_X_ADS).toBe(false);
  expect(config.ENABLE_VERCEL_ANALYTICS).toBe(false);
  expect(config.REACT_SCAN_MONITOR_API_KEY).toBeUndefined();
  expect(getLangfuseConfig().ENABLE_LANGFUSE).toBe(false);
});
