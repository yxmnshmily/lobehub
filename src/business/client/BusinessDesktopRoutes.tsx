import { type RouteObject } from 'react-router';

import { dynamicElement } from '@/utils/router';

export const BusinessDesktopRoutesWithMainLayout: RouteObject[] = [];
export const BusinessDesktopRoutesWithSettingsLayout: RouteObject[] = [];
export const BusinessDesktopRoutesWithoutMainLayout: RouteObject[] = [
  {
    path: '/embed/home',
    element: dynamicElement(() => import('@/features/HomeEmbed'), 'Desktop > Embedded home'),
  },
  {
    path: '/group-invite',
    element: dynamicElement(
      () => import('@/features/GroupMembership/InvitationPage'),
      'Desktop > Group invitation',
    ),
  },
];
export const BusinessResourceRoutes: RouteObject[] = [];
