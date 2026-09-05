import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ReactElement } from 'react';
import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';

import PlatformAdminRouteGuard, {
  CustomerMainRouteGuard,
} from '@/features/PlatformAdminRouteGuard';

import { mobileRoutes } from './mobileRouter.config';

describe('mobileRouter task routes', () => {
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
