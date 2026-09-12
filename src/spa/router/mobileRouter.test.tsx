import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ReactElement } from 'react';
import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';

import PlatformAdminRouteGuard, {
  CustomerMainRouteGuard,
} from '@/features/PlatformAdminRouteGuard';

import { mobileRoutes } from './mobileRouter.config';
import { getRouteMetaFromHandle } from './routeMeta';

describe('mobileRouter agent share route', () => {
  it('serves the agent-share visitor page on /a/:slugOrId outside the main layout', () => {
    const matches = matchRoutes(mobileRoutes, '/a/my-agent');

    expect(matches).toHaveLength(1);
    expect(matches?.[0]?.route.path).toBe('/a/:slugOrId/:topicId?');
    expect(matches?.[0]?.params).toMatchObject({ slugOrId: 'my-agent' });
  });

  it('opens a visitor topic directly without the owner layout', () => {
    const matches = matchRoutes(mobileRoutes, '/a/my-agent/tpc_saved');
    expect(matches).toHaveLength(1);
    expect(matches?.[0]?.params).toEqual({ slugOrId: 'my-agent', topicId: 'tpc_saved' });
  });

  it('keeps the creator agent surface on /agent/:aid', () => {
    const matches = matchRoutes(mobileRoutes, '/agent/my-agent');

    expect(matches?.some((match) => match.route.path === ':aid')).toBe(true);
    expect(matches?.at(-1)?.params).toMatchObject({ aid: 'my-agent' });
  });
});

describe('mobileRouter task routes', () => {
  it('registers the grouped settings home before workspace routes', () => {
    const matches = matchRoutes(mobileRoutes, '/me/settings');

    expect(matches, '/me/settings must match the mobile settings home').toBeTruthy();
    expect(matches?.some(({ route }) => route.path === 'me')).toBe(true);
    expect(matches?.at(-1)?.route.path).toBe('settings');
    expect(matches?.at(-1)?.params.workspaceSlug).toBeUndefined();
  });

  it.each([
    ['/memory', 'memory'],
    ['/memory/identities', 'identities'],
    ['/memory/contexts', 'contexts'],
    ['/memory/preferences', 'preferences'],
    ['/memory/experiences', 'experiences'],
    ['/memory/activities', 'activities'],
  ])('renders the mobile memory surface instead of the catch-all: %s', (pathname, expectedPath) => {
    const matches = matchRoutes(mobileRoutes, pathname);

    expect(matches, `${pathname} must match a route`).toBeTruthy();
    expect(matches?.some(({ route }) => route.path === 'memory')).toBe(true);
    expect(matches?.at(-1)?.route.path).toBe(expectedPath === 'memory' ? undefined : expectedPath);
    expect(matches?.at(-1)?.route.path).not.toBe('*');
  });

  it('resolves group members as a page instead of a topic id', () => {
    expect(matchRoutes(mobileRoutes, '/group/group-1/members')?.at(-1)?.route.path).toBe('members');
  });
  it('resolves group topics as a list page instead of a topic id', () => {
    expect(matchRoutes(mobileRoutes, '/group/group-1/topics')?.at(-1)?.route.path).toBe('topics');
  });
  it('keeps mobile navigation inside the /lobehub mount path', async () => {
    const source = await readFile(path.join(process.cwd(), 'src/spa/entry.mobile.tsx'), 'utf8');

    expect(source).toContain("const lobehubMountPath = '/lobehub'");
    expect(source).toContain('createAppRouter(mobileRoutes, { basename })');
  });

  it.each(['/group/group-1', '/group/group-1/topic-1'])(
    'registers the mobile group conversation route: %s',
    (pathname) => {
      const matches = matchRoutes(mobileRoutes, pathname);

      expect(matches?.some(({ route }) => route.path === 'group')).toBe(true);
      expect(matches?.at(-1)?.route.path).toBe(
        pathname.endsWith('topic-1') ? ':topicId' : undefined,
      );
    },
  );

  it.each(['profile', 'permission'])(
    'keeps mobile group management out of the topic-id route: %s',
    (section) => {
      const matches = matchRoutes(mobileRoutes, `/group/group-1/${section}`);

      expect(matches?.at(-1)?.route.path).toBe(section);
    },
  );

  it('guards the mobile main shell, including direct URLs', () => {
    const root = mobileRoutes.find((route) => route.path === '/');
    expect((root?.element as ReactElement | undefined)?.type).toBe(CustomerMainRouteGuard);
  });

  it('registers task list and detail routes under the shared workspace layout', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src/spa/router/mobileRouter.config.tsx'),
      'utf8',
    );

    expect(source).toContain("import('@/routes/(main)/(task-workspace)/_layout')");
    expect(source).toContain("import('@/routes/(main)/tasks')");
    expect(source).toContain("import('@/routes/(main)/task/[taskId]')");
    expect(source).toContain("import('@/routes/(main)/agent/task/[taskId]')");
    expect(source).toContain("path: 'tasks'");
    expect(source).toContain("path: 'task'");
    expect(source).toContain("path: ':taskId'");
    expect(source).toContain("path: ':aid/task/:taskId'");
    expect(source).not.toContain("import('@/routes/(main)/tasks/_layout')");
  });

  it('guards direct platform-settings URLs', () => {
    for (const pathname of [
      '/settings/provider/all',
      '/settings/skill',
      '/settings/apikey',
      '/settings/oauth-apps/client-1',
      '/settings/service-model',
      '/settings/credential',
      '/settings/memory',
      '/settings/appearance',
      '/settings/advanced',
      '/settings/labs',
      '/settings/connector',
      '/settings/notification',
      '/settings/service-operations',
      '/acme/settings/oauth-apps/client-1',
    ]) {
      const matches = matchRoutes(mobileRoutes, pathname);
      const hasPlatformGuard = matches?.some(
        ({ route }) =>
          (route.element as ReactElement | undefined)?.type === PlatformAdminRouteGuard,
      );

      expect(matches, `${pathname} must match a route`).toBeTruthy();
      expect(hasPlatformGuard, `${pathname} must require a platform administrator`).toBe(true);
    }
  });

  it('keeps customer settings URLs outside the platform guard', () => {
    for (const pathname of [
      '/settings/profile',
      '/settings/security',
      '/settings/credits',
      '/settings/billing',
      '/settings/works',
    ]) {
      const matches = matchRoutes(mobileRoutes, pathname);
      const hasPlatformGuard = matches?.some(
        ({ route }) =>
          (route.element as ReactElement | undefined)?.type === PlatformAdminRouteGuard,
      );

      expect(matches, `${pathname} must match a route`).toBeTruthy();
      expect(hasPlatformGuard, `${pathname} must stay customer-accessible`).toBe(false);
      if (pathname !== '/settings/works') {
        expect(matches?.at(-1)?.route.handle).toMatchObject({
          settingsTab: pathname.split('/').at(-1),
        });
      }
    }
  });

  it.each([
    '/settings',
    '/settings?active=apikey',
    '/settings?active=provider&provider=openai',
    '/settings?active=service-operations',
  ])('redirects the bare settings entry before a query can select a protected tab: %s', (url) => {
    const matches = matchRoutes(mobileRoutes, url);
    const element = matches?.at(-1)?.route.element as ReactElement<{ to: string }> | undefined;

    expect(element?.props.to).toBe('/settings/profile');
  });

  it('redirects the legacy works settings URL to /page', () => {
    const matches = matchRoutes(mobileRoutes, '/settings/works');
    const element = matches?.at(-1)?.route.element as ReactElement<{ to: string }> | undefined;

    expect(element?.props.to).toBe('/page');
  });

  it.each([
    '/page',
    '/page/document-1',
    '/page/document-1/permission',
    '/image?topic=image-1',
    '/video?topic=video-1',
    '/acme/page',
    '/acme/page/document-1',
    '/acme/page/document-1/permission',
    '/acme/image?topic=image-1',
    '/acme/video?topic=video-1',
  ])('registers customer creation pages on mobile: %s', (pathname) => {
    const matches = matchRoutes(mobileRoutes, pathname);

    expect(matches, `${pathname} must match a route`).toBeTruthy();
    const pathWithoutWorkspace = pathname.replace(/^\/acme/, '');
    const expectedPath = pathWithoutWorkspace.startsWith('/page')
      ? 'page'
      : pathWithoutWorkspace.startsWith('/image')
        ? 'image'
        : 'video';
    expect(matches?.some(({ route }) => route.path === expectedPath)).toBe(true);
    const expectedLeaf = pathWithoutWorkspace.endsWith('/permission')
      ? ':id/permission'
      : pathWithoutWorkspace === '/page' || expectedPath !== 'page'
        ? undefined
        : ':id';
    expect(matches?.at(-1)?.route.path).toBe(expectedLeaf);
  });

  it.each([
    '/resource',
    '/resource/page',
    '/resource/documents',
    '/resource/library/library-1',
    '/resource/library/library-1/permission',
    '/resource/library/library-1/document-1',
    '/acme/resource',
    '/acme/resource/page',
    '/acme/resource/library/library-1',
  ])('registers mobile resource pages without falling through: %s', (pathname) => {
    const matches = matchRoutes(mobileRoutes, pathname);

    expect(matches, `${pathname} must match a route`).toBeTruthy();
    expect(matches?.some(({ route }) => route.path === 'resource')).toBe(true);
    expect(matches?.at(-1)?.route.path).not.toBe('*');
    if (pathname.endsWith('/resource/page')) expect(matches?.at(-1)?.route.path).toBe('page');
  });

  it.each(['plans', 'usage', 'credits', 'billing'])(
    'redirects legacy workspace billing to sibling settings: %s',
    (tab) => {
      const matches = matchRoutes(mobileRoutes, `/acme/billing/${tab}`);
      const element = matches?.at(-1)?.route.element as ReactElement<{ to: string }> | undefined;

      expect(element?.props.to).toBe(`../../settings/${tab}`);
    },
  );

  it.each([
    ['/community/skill', 'skill'],
    ['/community/skill/travel-guide', 'skill/:slug'],
    ['/community/group_agent/travel-team', 'group_agent/:slug'],
  ])('registers mobile community links: %s', (pathname, expectedPath) => {
    const matches = matchRoutes(mobileRoutes, pathname);

    expect(matches?.at(-1)?.route.path).toBe(expectedPath);
  });
});

describe('mobileRouter workspace provider routes', () => {
  it('registers workspace provider list and path-shaped deep-link redirect', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src/spa/router/mobileRouter.config.tsx'),
      'utf8',
    );

    // Without these, workspace-aware provider links (`/:slug/settings/provider/:id`)
    // fall through to the mobile `*` route and kick the user out of the workspace.
    expect(source).toContain("import('@/routes/(main)/[workspaceSlug]/settings/provider')");
    // The mobile route must use the mobile variant, otherwise the page renders
    // the desktop 280px provider menu layout on phones.
    expect(source).toContain('m.WorkspaceProviderSettingMobile');
    // The redirect is statically imported: lazy-loading it would flash the
    // generic brand loader before redirecting.
    expect(source).toContain("from '@/features/WorkspaceSetting/ProviderRedirect'");
    expect(source).toContain("path: 'provider'");
    expect(source).toContain("path: 'provider/:providerId'");
  });
});

describe('mobile community route layouts', () => {
  it('renders community list and detail pages without layout-level SWR suspense', async () => {
    const readLayout = (layoutPath: string) =>
      readFile(path.join(process.cwd(), layoutPath), 'utf8');

    const [listLayout, detailLayout] = await Promise.all([
      readLayout('src/routes/(mobile)/community/(list)/_layout/index.tsx'),
      readLayout('src/routes/(mobile)/community/(detail)/_layout/index.tsx'),
    ]);

    for (const source of [listLayout, detailLayout]) {
      expect(source).not.toContain('SWRConfig');
      expect(source).not.toContain('SuspenseRouteBoundary');
      expect(source).toContain('<RouteSkeletonChromeProvider>');
      expect(source).toContain('<Outlet />');
    }
  });

  it('declares a route skeleton for the community list and detail layouts', () => {
    const listMatches = matchRoutes(mobileRoutes, '/community/agent');
    const detailMatches = matchRoutes(mobileRoutes, '/community/agent/my-agent');

    expect(listMatches?.some((match) => getRouteMetaFromHandle(match.route.handle)?.Skeleton)).toBe(
      true,
    );
    expect(
      detailMatches?.some((match) => getRouteMetaFromHandle(match.route.handle)?.Skeleton),
    ).toBe(true);
  });
});
