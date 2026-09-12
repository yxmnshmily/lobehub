import { type RouteObject } from 'react-router';

import { dynamicElement } from '@/utils/router';

export const BusinessMobileRoutesWithMainLayout: RouteObject[] = [];
export const BusinessMobileRoutesWithSettingsLayout: RouteObject[] = [];
export const BusinessMobileRoutesWithoutMainLayout: RouteObject[] = [
  {
    path: '/embed/home',
    element: dynamicElement(() => import('@/features/HomeEmbed'), 'Mobile > Embedded home'),
  },
  {
    path: '/group-invite',
    element: dynamicElement(
      () => import('@/features/GroupMembership/InvitationPage'),
      'Mobile > Group invitation',
    ),
  },
];
