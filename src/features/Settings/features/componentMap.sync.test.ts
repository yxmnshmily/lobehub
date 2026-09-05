import { describe, expect, it, vi } from 'vitest';

import { componentMap as webMap } from './componentMap';
import { componentMap as desktopMap } from './componentMap.desktop';

vi.mock('@lobechat/builtin-tool-travel-production', () => ({
  TravelProductionIdentifier: 'travel-production',
  TravelProductionManifest: { identifier: 'travel-production' },
}));
vi.mock('@/business/client/BusinessSettingPages/ServiceOperations', () => ({
  default: () => null,
}));

describe('componentMap desktop sync', () => {
  it('desktop keys must match web keys', () => {
    const webKeys = Object.keys(webMap).sort();
    const desktopKeys = Object.keys(desktopMap).sort();

    const missingInDesktop = webKeys.filter((k) => !desktopKeys.includes(k));
    const extraInDesktop = desktopKeys.filter((k) => !webKeys.includes(k));

    expect(
      missingInDesktop,
      `Missing in componentMap.desktop: ${missingInDesktop.join(', ')}`,
    ).toEqual([]);
    expect(extraInDesktop, `Extra in componentMap.desktop: ${extraInDesktop.join(', ')}`).toEqual(
      [],
    );
  });
});
