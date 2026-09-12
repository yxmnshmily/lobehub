import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_SETTINGS_TAB_PATHS,
  PLATFORM_SETTINGS_TAB_PATHS,
  resolveCustomerMainRouteAccess,
  resolvePlatformAdminRouteAccess,
} from './access';

describe('resolvePlatformAdminRouteAccess', () => {
  it('redirects an ordinary customer opening a platform settings URL directly', () => {
    expect(resolvePlatformAdminRouteAccess({ isLoading: false, isPlatformAdmin: false })).toBe(
      'redirect',
    );
  });

  it('allows a global platform administrator', () => {
    expect(resolvePlatformAdminRouteAccess({ isLoading: false, isPlatformAdmin: true })).toBe(
      'allow',
    );
  });

  it('does not render protected content while authorization is loading', () => {
    expect(resolvePlatformAdminRouteAccess({ isLoading: true })).toBe('loading');
  });

  it('keeps the customer and platform settings boundaries explicit', () => {
    expect(CUSTOMER_SETTINGS_TAB_PATHS).toEqual([
      'profile',
      'security',
      'plans',
      'usage',
      'credits',
      'billing',
    ]);
    expect(PLATFORM_SETTINGS_TAB_PATHS).toEqual([
      'apikey',
      'credential',
      'oauth-apps',
      'service-operations',
      'service-model',
      'skill',
    ]);
  });
});

describe('resolveCustomerMainRouteAccess', () => {
  it.each([
    '',
    '/conversation',
    '/conversation/topic-1',
    '/tasks',
    '/goals',
    '/acceptance',
    '/task/T-1',
    '/goal/G-1',
    '/acceptance/A-1',
    '/acceptance/A-1/check/C-1',
  ])(
    'allows the embedded project page without opening unrelated configuration routes: %s',
    (suffix) => {
      expect(
        resolveCustomerMainRouteAccess({
          isLoading: false,
          isPlatformAdmin: false,
          pathname: `/group/group-1/project/project-1${suffix}`,
        }),
      ).toBe('allow');
      expect(
        resolveCustomerMainRouteAccess({
          isLoading: false,
          isPlatformAdmin: false,
          pathname: '/group/group-1/project/project-1/settings',
        }),
      ).toBe('redirect');
    },
  );
  it.each([
    '/',
    '/settings',
    '/settings/profile',
    '/settings/plans',
    '/settings/usage',
    '/settings/security/password',
    '/settings/credits',
    '/settings/billing/history',
    '/settings/works',
    '/page',
    '/page/work-1',
    '/image',
    '/video',
    '/memory',
    '/memory/identities',
    '/memory/contexts',
    '/memory/preferences',
    '/memory/experiences',
    '/memory/activities',
    '/me',
    '/me/profile',
    '/me/settings',
    '/group/customer-private-group',
    '/group/customer-private-group/profile',
    '/group/customer-private-group/topic-123',
  ])('keeps customer account and owned-work pages accessible: %s', (pathname) => {
    expect(
      resolveCustomerMainRouteAccess({ isLoading: false, isPlatformAdmin: false, pathname }),
    ).toBe('allow');
  });

  it.each([
    '?active=profile',
    '?active=security',
    '?active=plans',
    '?active=usage',
    '?active=credits',
    '?active=billing',
  ])('allows customer tabs on the legacy mobile settings query route: %s', (search) => {
    expect(
      resolveCustomerMainRouteAccess({
        isLoading: false,
        isPlatformAdmin: false,
        pathname: '/settings',
        search,
      }),
    ).toBe('allow');
  });

  it.each(['balance-usage', 'my-creations', 'private-group'])(
    'keeps a refreshed customer-center section accessible: %s',
    (section) => {
      expect(
        resolveCustomerMainRouteAccess({
          isLoading: false,
          isPlatformAdmin: false,
          pathname: '/settings/credits',
          search: `?section=${section}`,
        }),
      ).toBe('allow');
    },
  );

  it.each(['?active=apikey', '?active=provider', '?active=service-operations', '?active=unknown'])(
    'fails closed for protected or unknown legacy mobile settings tabs: %s',
    (search) => {
      expect(
        resolveCustomerMainRouteAccess({
          isLoading: false,
          isPlatformAdmin: false,
          pathname: '/settings',
          search,
        }),
      ).toBe('redirect');
    },
  );

  it.each([
    '/agent/default-travel-copywriter',
    '/group/customer-private-group/permission',
    '/group/customer-private-group/settings',
    '/group/customer-private-group/members',
    '/group/customer-private-group/member-management',
    '/group/customer-private-group/topic-123/extra',
    '/groups/customer-private-group',
    '/groupish/customer-private-group',
    '/tasks',
    '/resource',
    '/community',
    '/settings/apikey',
    '/settings/credential',
    '/settings/labs',
    '/settings/oauth-apps',
    '/settings/provider/all',
    '/settings/service-model',
    '/settings/service-operations',
    '/settings/skill',
    '/settings/storage',
    '/settings/users',
    '/settings/usage/admin',
    '/acme/settings/usage',
    '/settings/memory',
    '/users',
    '/settings/works/work-1',
    '/page/work-1/permission',
    '/acme/settings/profile',
  ])('redirects an ordinary customer away from the LobeHub production shell: %s', (pathname) => {
    expect(
      resolveCustomerMainRouteAccess({ isLoading: false, isPlatformAdmin: false, pathname }),
    ).toBe('redirect');
  });

  it('allows a global platform administrator through every main-app route', () => {
    expect(
      resolveCustomerMainRouteAccess({
        isLoading: false,
        isPlatformAdmin: true,
        pathname: '/group/default-travel-service-group',
      }),
    ).toBe('allow');
  });

  it.each([
    '/group/group-1',
    '/group/group-1/topic-1',
    '/settings/profile',
    '/settings/credits',
    '/me',
  ])(
    'does not replace an allowed customer page while the admin check is pending: %s',
    (pathname) => {
      expect(resolveCustomerMainRouteAccess({ isLoading: true, pathname })).toBe('allow');
    },
  );

  it.each(['/settings/provider/all', '/group/group-1/settings', '/settings/users'])(
    'still waits before rendering an admin-only route: %s',
    (pathname) => {
      expect(resolveCustomerMainRouteAccess({ isLoading: true, pathname })).toBe('loading');
    },
  );

  it('does not render protected settings tabs while authorization is loading', () => {
    expect(
      resolveCustomerMainRouteAccess({
        isLoading: true,
        pathname: '/settings',
        search: '?active=service-operations',
      }),
    ).toBe('loading');
  });
});
