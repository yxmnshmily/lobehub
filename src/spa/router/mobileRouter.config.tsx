'use client';

import type { RouteObject } from 'react-router';

import {
  BusinessMobileRoutesWithMainLayout,
  BusinessMobileRoutesWithoutMainLayout,
} from '@/business/client/BusinessMobileRoutes';
import AppsSkeleton from '@/components/Skeleton/Apps';
import ConversationLayoutSkeleton from '@/components/Skeleton/Conversation/Layout';
import { acceptanceRouteMeta } from '@/features/Acceptance/routeMeta';
import AgentRouteSwitch from '@/features/AgentRoute/AgentRouteSwitch';
import AgentShareLegacyRedirect from '@/features/AgentShareVisitor/LegacyRedirect';
import { agentShareVisitorRouteMeta } from '@/features/AgentShareVisitor/routeMeta';
import { customerMainElement, platformAdminElement } from '@/features/PlatformAdminRouteGuard';
import {
  CUSTOMER_SETTINGS_TAB_PATHS,
  PLATFORM_SETTINGS_TAB_PATHS,
} from '@/features/PlatformAdminRouteGuard/access';
import { mobileAgentSettingsRouteMeta } from '@/features/RouteMeta/mobileRouteMeta';
import WorkspaceProviderRedirect from '@/features/WorkspaceSetting/ProviderRedirect';
import { agentRouteMeta } from '@/routes/(main)/agent/features/routeMeta';
import {
  groupPermissionRouteMeta,
  groupProfileRouteMeta,
  groupRouteMeta,
} from '@/routes/(main)/group/features/routeMeta';
import { loadRouteWithBuiltinToolSurfaces } from '@/spa/initialize/toolSurfaces';
import { dynamicElement, dynamicLayout, ErrorBoundary, redirectElement } from '@/utils/router';

const mobileChatElement = dynamicElement(
  () => loadRouteWithBuiltinToolSurfaces(() => import('@/routes/(mobile)/chat')),
  'Mobile > Chat',
  { preloadId: 'mobile-agent' },
);

const mobileGroupChatElement = dynamicElement(
  () => loadRouteWithBuiltinToolSurfaces(() => import('@/routes/(main)/group')),
  'Mobile > Group',
  { preloadId: 'mobile-group' },
);

const mobileSettingsElement = dynamicElement(
  () => import('@/routes/(mobile)/settings'),
  'Mobile > Settings > Content',
  { preloadId: 'mobile-settings' },
);

/**
 * Children shared between `/` and `/:workspaceSlug` for mobile. Mobile only
 * mirrors the subset of routes it actually supports — settings / me / default
 * home stay personal-only.
 */
export const sharedMainAreaChildren: RouteObject[] = [
  // Chat routes
  {
    children: [
      {
        element: redirectElement('..'),
        index: true,
      },
      {
        children: [
          {
            element: mobileChatElement,
            handle: { meta: agentRouteMeta },
            index: true,
          },
          {
            element: mobileChatElement,
            handle: { meta: agentRouteMeta },
            path: ':topicId',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(mobile)/chat/settings'),
              'Mobile > Chat > Settings',
            ),
            handle: { meta: mobileAgentSettingsRouteMeta },
            path: 'settings',
          },
        ],
        // `/agent/:aid` serves both the creator's own agent and the agent-share
        // visitor surface; the param decides which — see `AgentRouteSwitch`.
        element: (
          <AgentRouteSwitch
            fallback={<ConversationLayoutSkeleton />}
            // Mobile has no share settings page; the agent itself is the closest stop.
            ownShareRedirect={(agentId) => `/agent/${agentId}`}
            ownElement={dynamicLayout(
              () => import('@/routes/(mobile)/chat/_layout'),
              'Mobile > Chat > Layout',
              { preloadId: 'mobile-agent' },
            )}
            shareElement={dynamicElement(
              () => import('@/features/AgentShareVisitor/Page'),
              'Mobile > Share > Agent',
              { fallback: <ConversationLayoutSkeleton /> },
            )}
          />
        ),
        errorElement: <ErrorBoundary />,
        path: ':aid',
      },
    ],
    path: 'agent',
  },

  // Group conversation routes use the responsive group surface without the
  // desktop NavPanel host; the sidebar portal is therefore inert on mobile.
  {
    children: [
      {
        element: redirectElement('..'),
        index: true,
      },
      {
        children: [
          {
            element: mobileGroupChatElement,
            handle: { meta: groupRouteMeta },
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/group/profile'),
              'Mobile > Agent Group > Profile',
            ),
            handle: { meta: groupProfileRouteMeta },
            path: 'profile',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/group/permission'),
              'Mobile > Agent Group > Permission',
            ),
            handle: { meta: groupPermissionRouteMeta },
            path: 'permission',
          },
          {
            element: mobileGroupChatElement,
            handle: { meta: groupRouteMeta },
            path: ':topicId',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/group/_layout'),
          'Mobile > Group > Layout',
          { preloadId: 'mobile-group' },
        ),
        errorElement: <ErrorBoundary />,
        path: ':gid',
      },
    ],
    path: 'group',
  },

  // Discover routes with nested structure
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/community/(detail)/workspace/settings'),
          'Mobile > Discover > Workspace > Settings',
        ),
        path: 'workspace/settings',
      },
      // List routes (with ListLayout)
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/(home)'),
              'Mobile > Discover > List > Home',
              { preloadId: 'mobile-community' },
            ),
            index: true,
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/agent'),
                  'Mobile > Discover > List > Agent',
                ),
                path: 'agent',
              },
            ],
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/model'),
                  'Mobile > Discover > List > Model',
                ),
                path: 'model',
              },
            ],
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/provider'),
              'Mobile > Discover > List > Provider',
            ),
            path: 'provider',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/skill'),
              'Mobile > Discover > List > Skill',
            ),
            path: 'skill',
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/mcp'),
                  'Mobile > Discover > List > MCP',
                ),
                path: 'mcp',
              },
            ],
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/workspace').then(
                  (m) => m.MobileWorkspaceDetailPage,
                ),
              'Mobile > Discover > List > Workspace',
            ),
            path: 'workspace',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(mobile)/community/(list)/_layout'),
          'Mobile > Discover > List > Layout',
          { preloadId: 'mobile-community' },
        ),
      },
      // Detail routes (with DetailLayout)
      {
        children: [
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/agent').then(
                  (m) => m.MobileDiscoverAssistantDetailPage,
                ),
              'Mobile > Discover > Detail > Agent',
            ),
            path: 'agent/:slug',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/group_agent').then(
                  (m) => m.MobileGroupAgentDetailPage,
                ),
              'Mobile > Discover > Detail > Group Agent',
            ),
            path: 'group_agent/:slug',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/model').then((m) => m.MobileModelPage),
              'Mobile > Discover > Detail > Model',
            ),
            path: 'model/:slug',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/provider').then(
                  (m) => m.MobileProviderPage,
                ),
              'Mobile > Discover > Detail > Provider',
            ),
            path: 'provider/:slug',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/skill').then((m) => m.MobileSkillPage),
              'Mobile > Discover > Detail > Skill',
            ),
            path: 'skill/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/mcp').then((m) => m.MobileMcpPage),
              'Mobile > Discover > Detail > MCP',
            ),
            path: 'mcp/:slug',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/user').then(
                  (m) => m.MobileUserDetailPage,
                ),
              'Mobile > Discover > Detail > User',
            ),
            path: 'user/:slug',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/organization').then(
                  (m) => m.MobileOrganizationDetailPage,
                ),
              'Mobile > Discover > Detail > Organization',
            ),
            path: 'org/:slug',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(mobile)/community/(detail)/_layout'),
          'Mobile > Discover > Detail > Layout',
        ),
      },
    ],
    element: dynamicElement(
      () => import('@/routes/(mobile)/community/_layout'),
      'Mobile > Discover > Layout',
      { preloadId: 'mobile-community' },
    ),
    errorElement: <ErrorBoundary />,
    path: 'community',
  },

  // Agents view-all route (flat list of workspace/private agents)
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/agents'), 'Mobile > Agents', {
          preloadId: 'mobile-agents',
        }),
        index: true,
      },
    ],
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'agents',
  },

  // Task workspace routes (cross-agent)
  {
    children: [
      {
        children: [
          {
            element: dynamicElement(() => import('@/routes/(main)/tasks'), 'Mobile > Tasks', {
              preloadId: 'mobile-tasks',
            }),
            index: true,
          },
        ],
        errorElement: <ErrorBoundary resetPath=".." />,
        path: 'tasks',
      },
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/task/[taskId]'),
              'Mobile > Task Detail',
            ),
            path: ':taskId',
          },
        ],
        errorElement: <ErrorBoundary resetPath="../tasks" />,
        path: 'task',
      },
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/agent/task/[taskId]'),
              'Mobile > Agent Task Detail',
            ),
            path: ':aid/task/:taskId',
          },
        ],
        errorElement: <ErrorBoundary resetPath="../tasks" />,
        path: 'agent',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/(task-workspace)/_layout'),
      'Mobile > Task Workspace > Layout',
      { preloadId: 'mobile-tasks' },
    ),
  },

  // Customer-created pages are workspace-aware on desktop, so the mobile
  // router must expose the same paths under both `/page` and `/:slug/page`.
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/page'), 'Mobile > Page'),
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/page/[id]'),
          'Mobile > Page > Detail',
        ),
        path: ':id',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/page/[id]/permission'),
          'Mobile > Page > Permission',
        ),
        path: ':id/permission',
      },
    ],
    element: dynamicLayout(() => import('@/routes/(main)/page/_layout'), 'Mobile > Page > Layout'),
    errorElement: <ErrorBoundary />,
    path: 'page',
  },

  // Resource routes reuse the responsive main surfaces. Static `page` stays
  // before `:category`, otherwise `/resource/page` is swallowed as a category.
  {
    children: [
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/(home)'),
              'Mobile > Resource > Home',
            ),
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/(home)'),
              'Mobile > Resource > Home > Pages',
            ),
            path: 'page',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/(home)'),
              'Mobile > Resource > Home > Category',
            ),
            path: ':category',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/resource/(home)/_layout'),
          'Mobile > Resource > Home > Layout',
        ),
      },
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/library'),
              'Mobile > Resource > Library',
            ),
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/library/permission'),
              'Mobile > Resource > Library > Permission',
            ),
            path: 'permission',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/library/[slug]'),
              'Mobile > Resource > Library > Slug',
            ),
            path: ':slug',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/resource/library/_layout'),
          'Mobile > Resource > Library > Layout',
        ),
        path: 'library/:id',
      },
    ],
    element: dynamicElement(
      () => import('@/routes/(main)/resource/_layout'),
      'Mobile > Resource > Layout',
      { preloadId: 'resource' },
    ),
    errorElement: <ErrorBoundary />,
    path: 'resource',
  },

  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/(create)/image'), 'Mobile > Image'),
        index: true,
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/(create)/image/_layout'),
      'Mobile > Image > Layout',
    ),
    errorElement: <ErrorBoundary />,
    path: 'image',
  },
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/(create)/video'), 'Mobile > Video'),
        index: true,
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/(create)/video/_layout'),
      'Mobile > Video > Layout',
    ),
    errorElement: <ErrorBoundary />,
    path: 'video',
  },

  ...BusinessMobileRoutesWithMainLayout,
];

// Mobile router configuration (declarative mode)
export const mobileRoutes: RouteObject[] = [
  {
    children: [
      ...sharedMainAreaChildren,

      // Apps page (personal-only — never mirrored under /:workspaceSlug)
      {
        element: dynamicElement(() => import('@/routes/(main)/apps'), 'Mobile > Apps', {
          fallback: <AppsSkeleton />,
        }),
        errorElement: <ErrorBoundary />,
        path: 'apps',
      },

      // Settings routes (personal-only — never mirrored under /:workspaceSlug)
      {
        children: [
          {
            element: redirectElement('/settings/profile'),
            index: true,
          },
          // Provider routes with nested structure
          {
            children: [
              {
                element: redirectElement('/settings/provider/all'),
                index: true,
              },
              {
                element: dynamicElement(
                  () =>
                    import('@/routes/(main)/settings/provider').then((m) => m.ProviderDetailPage),
                  'Mobile > Settings > Provider > Detail',
                ),
                path: ':providerId',
              },
            ],
            element: platformAdminElement(
              dynamicLayout(
                () => import('@/routes/(mobile)/settings/provider/_layout'),
                'Mobile > Settings > Provider > Layout',
              ),
            ),
            path: 'provider',
          },
          {
            element: redirectElement('/settings/credential'),
            path: 'creds',
          },
          {
            element: redirectElement('/page'),
            path: 'works',
          },
          ...CUSTOMER_SETTINGS_TAB_PATHS.flatMap((tab) => [
            {
              element: mobileSettingsElement,
              handle: { settingsTab: tab },
              path: tab,
            },
            {
              element: mobileSettingsElement,
              handle: { settingsTab: tab },
              path: `${tab}/:sub`,
            },
          ]),
          ...PLATFORM_SETTINGS_TAB_PATHS.flatMap((tab) => [
            {
              element: platformAdminElement(mobileSettingsElement),
              handle: { settingsTab: tab },
              path: tab,
            },
            {
              element: platformAdminElement(mobileSettingsElement),
              handle: { settingsTab: tab },
              path: `${tab}/:sub`,
            },
          ]),
          // Other settings tabs (common, agent, memory, tts, about, etc.)
          {
            element: platformAdminElement(mobileSettingsElement),
            path: ':tab',
          },
          {
            element: platformAdminElement(mobileSettingsElement),
            path: ':tab/:sub',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(mobile)/settings/_layout'),
          'Mobile > Settings > Layout',
          { preloadId: 'mobile-settings' },
        ),
        errorElement: <ErrorBoundary />,
        path: 'settings',
      },

      // Me routes (mobile personal center — never mirrored under /:workspaceSlug)
      {
        children: [
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(mobile)/me/(home)'),
                  'Mobile > Me > Home',
                ),
                index: true,
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(mobile)/me/(home)/layout'),
              'Mobile > Me > Home > Layout',
            ),
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(mobile)/me/profile'),
                  'Mobile > Me > Profile',
                ),
                path: 'profile',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(mobile)/me/profile/layout'),
              'Mobile > Me > Profile > Layout',
            ),
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(mobile)/me/settings'),
                  'Mobile > Me > Settings',
                ),
                path: 'settings',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(mobile)/me/settings/layout'),
              'Mobile > Me > Settings > Layout',
            ),
          },
        ],
        errorElement: <ErrorBoundary />,
        path: 'me',
      },

      // Default route - home page
      {
        children: [
          {
            element: dynamicElement(() => import('@/routes/(mobile)/(home)/'), 'Mobile > Home', {
              preloadId: 'mobile-home',
            }),
            index: true,
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(mobile)/(home)/_layout'),
          'Mobile > Home > Layout',
          { preloadId: 'mobile-home' },
        ),
      },

      // Workspace slug routes — `/:workspaceSlug/*` mirrors the shared main area.
      // Must come AFTER all reserved root paths so they don't shadow e.g. /agent.
      {
        children: [
          // Workspace home — handled by the persistent home layout (mirrors
          // how `/` index is empty); rendering here would duplicate Home.
          {
            index: true,
          },
          ...sharedMainAreaChildren,
          // Workspace settings — `/:slug/settings/*`. Mobile reuses the mobile
          // settings chrome (header + content wrapper) for now; a dedicated
          // mobile workspace sidebar is follow-up work.
          {
            children: [
              { element: redirectElement('general'), index: true },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/general'),
                  'Mobile > Workspace > Settings > General',
                ),
                path: 'general',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/members'),
                  'Mobile > Workspace > Settings > Members',
                ),
                path: 'members',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/notification'),
                  'Mobile > Workspace > Settings > Notification',
                ),
                path: 'notification',
              },
              // Channel detail level of the two-level notification settings —
              // the page reads the channel id from the `sub` route param.
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/notification'),
                  'Mobile > Workspace > Settings > Notification > Channel',
                ),
                path: 'notification/:sub',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/labels'),
                  'Mobile > Workspace > Settings > Labels',
                ),
                path: 'labels',
              },
              {
                element: dynamicElement(
                  () =>
                    import('@/routes/(main)/[workspaceSlug]/settings/provider').then(
                      (m) => m.WorkspaceProviderSettingMobile,
                    ),
                  'Mobile > Workspace > Settings > Provider',
                ),
                path: 'provider',
              },
              // Path-shaped provider deep-links (`/:slug/settings/provider/:id`)
              // redirect to the query form the workspace provider page uses, so
              // they don't fall through to the catch-all and leave the workspace.
              // Static element: the redirect is tiny and lazy-loading it would
              // flash the generic brand loader before redirecting.
              {
                element: <WorkspaceProviderRedirect />,
                path: 'provider/:providerId',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/plans'),
                  'Mobile > Workspace > Settings > Plans',
                ),
                path: 'plans',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/billing'),
                  'Mobile > Workspace > Settings > Billing',
                ),
                path: 'billing',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/budget'),
                  'Mobile > Workspace > Settings > Budget',
                ),
                path: 'budget',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/credits'),
                  'Mobile > Workspace > Settings > Credits',
                ),
                path: 'credits',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/usage'),
                  'Mobile > Workspace > Settings > Usage',
                ),
                path: 'usage',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/audit-log'),
                  'Mobile > Workspace > Settings > Audit Log',
                ),
                path: 'audit-log',
              },
              {
                element: platformAdminElement(
                  dynamicElement(
                    () => import('@/routes/(main)/[workspaceSlug]/settings/oauth-apps'),
                    'Mobile > Workspace > Settings > OAuth Apps',
                  ),
                ),
                path: 'oauth-apps',
              },
              {
                element: platformAdminElement(
                  dynamicElement(
                    () => import('@/routes/(main)/[workspaceSlug]/settings/oauth-apps'),
                    'Mobile > Workspace > Settings > OAuth App Detail',
                  ),
                ),
                path: 'oauth-apps/:sub',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(mobile)/settings/_layout'),
              'Mobile > Workspace > Settings > Layout',
            ),
            errorElement: <ErrorBoundary />,
            path: 'settings',
          },
          // Legacy `/:slug/billing/*` URLs — redirect to `/:slug/settings/*`.
          {
            children: [
              { element: redirectElement('../../settings/plans'), path: 'plans' },
              { element: redirectElement('../../settings/usage'), path: 'usage' },
              { element: redirectElement('../../settings/credits'), path: 'credits' },
              { element: redirectElement('../../settings/billing'), path: 'billing' },
            ],
            path: 'billing',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/[workspaceSlug]/_layout'),
          'Mobile > Workspace > Layout',
        ),
        errorElement: <ErrorBoundary />,
        path: ':workspaceSlug',
      },

      // Catch-all route
      {
        element: redirectElement('/'),
        path: '*',
      },
    ],
    element: customerMainElement(
      dynamicLayout(() => import('@/routes/(mobile)/_layout'), 'Mobile > Main > Layout'),
    ),
    errorElement: <ErrorBoundary />,
    path: '/',
  },
  // Onboarding route (outside main layout)
  {
    element: dynamicElement(() => import('@/routes/onboarding'), 'Mobile > Onboarding'),
    errorElement: <ErrorBoundary />,
    path: '/onboarding',
  },
  ...BusinessMobileRoutesWithoutMainLayout,

  // `/share/*` is served by the standalone Share app (apps/share), not this
  // router. The agent-share visitor surface moved to `/agent/:aid` (it needs
  // the full chat runtime, so it stays in the main SPA on every platform), but
  // old links must keep working: without this entry a phone opening one falls
  // through to `*` and gets bounced home instead of redirected.
  {
    element: <AgentShareLegacyRedirect />,
    errorElement: <ErrorBoundary />,
    handle: { meta: agentShareVisitorRouteMeta },
    path: '/share/agent/:slugOrId',
  },

  // Messenger verify route (outside main layout)
  {
    element: dynamicElement(() => import('@/routes/verify-im'), 'Mobile > VerifyIm'),
    errorElement: <ErrorBoundary />,
    path: '/verify-im',
  },

  {
    element: dynamicElement(
      () => import('@/routes/acceptance/[acceptanceId]'),
      'Mobile > AcceptanceReport',
    ),
    errorElement: <ErrorBoundary />,
    handle: { meta: acceptanceRouteMeta },
    path: '/acceptance/:acceptanceId',
  },
  {
    element: dynamicElement(
      () => import('@/routes/acceptance/[acceptanceId]'),
      'Mobile > AcceptanceCheck',
    ),
    errorElement: <ErrorBoundary />,
    handle: { meta: acceptanceRouteMeta },
    path: '/acceptance/:acceptanceId/check/:checkId',
  },
];
