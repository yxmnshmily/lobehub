'use client';

import { Flexbox } from '@lobehub/ui';
import { useLocation } from 'react-router';

import SettingContainer from '@/features/Setting/SettingContainer';
import SettingsPageHeader from '@/features/Settings/features/SettingsPageHeader';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from '../Bar';
import SurfaceSkeleton, { type SurfaceSkeletonVariant } from '../Surface';
import SettingsProfileSkeleton from './Profile';
import SettingsSectionSkeleton from './Section';

/**
 * Skeleton shape per settings tab, so the placeholder matches the real page
 * that replaces it. Form-style pages use the row-based section skeleton (the
 * closest match to a FormGroup stack); the rest use the shared surface shapes.
 */
const TAB_SURFACE: Record<string, SurfaceSkeletonVariant | 'section'> = {
  // list-style pages
  'creds': 'list',
  'devices': 'list',
  'labels': 'list',
  // two-column / detail pages
  'connector': 'detail',
  'content-moderation': 'detail',
  'skill': 'detail',
  'usage': 'detail',
  // grid-style pages
  'community': 'grid',
  'provider': 'grid',
  // form-style pages (default section skeleton)
  'appearance': 'section',
  'hotkey': 'section',
  'memory': 'section',
  'messenger': 'section',
  'notification': 'section',
  'service-model': 'section',
};

const SettingsPageSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => {
  const { pathname } = useLocation();
  const tab = pathname.match(/\/settings\/([^/]+)/)?.[1] ?? 'profile';
  const profile = tab === 'profile';

  return (
    <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      {chrome !== 'body' && (
        <SettingsPageHeader title={<SkeletonBar height={16} width={profile ? 52 : 88} />} />
      )}
      {/* Must match the real settings container exactly (100% width, 48px gutter)
          — a 24px/960px skeleton made content jump on every tab switch. */}
      <SettingContainer gap={32} maxWidth={'100%'} paddingBlock={48} paddingInline={48}>
        {profile ? (
          <SettingsProfileSkeleton />
        ) : (TAB_SURFACE[tab] ?? 'section') === 'section' ? (
          <SettingsSectionSkeleton />
        ) : (
          <SurfaceSkeleton header={false} variant={TAB_SURFACE[tab] as SurfaceSkeletonVariant} />
        )}
      </SettingContainer>
    </Flexbox>
  );
};

export default SettingsPageSkeleton;
