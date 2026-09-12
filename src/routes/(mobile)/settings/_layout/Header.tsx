'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { ChevronLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch, useMatches, useParams, useSearchParams } from 'react-router';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { SettingsTabs } from '@/store/global/initialState';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

// Explicit tab → i18n key map. Covers:
// - Cross-namespace entries (subscription / auth).
// - Kebab-case SettingsTabs (e.g. 'service-model') whose URL slug doesn't match the camelCase locale key.
//   Without an explicit entry, `setting:tab.${tab}` would resolve to a missing key and render the raw string.
// - Profile: prefer shorter "Profile" (`auth:profile.title`) over "My Account" (`auth:tab.profile`) on mobile.
const TAB_TITLE_KEY: Partial<Record<SettingsTabs, string>> = {
  [SettingsTabs.Billing]: '积分明细',
  [SettingsTabs.Credits]: '积分余额',
  [SettingsTabs.Creds]: 'setting:tab.creds',
  [SettingsTabs.Labs]: 'labs:title',
  [SettingsTabs.OAuthApps]: 'auth:tab.oauthApps',
  [SettingsTabs.Plans]: 'subscription:tab.plans',
  [SettingsTabs.Profile]: 'auth:profile.title',
  [SettingsTabs.Referral]: 'subscription:tab.referral',
  [SettingsTabs.ServiceModel]: 'setting:tab.serviceModel',
  [SettingsTabs.ServiceOperations]: '平台用户运营',
  [SettingsTabs.Stats]: 'auth:tab.stats',
  [SettingsTabs.SystemTools]: 'setting:tab.systemTools',
  [SettingsTabs.Usage]: 'common:travelUi.账户用量',
};

const WORKSPACE_TAB_TITLE_KEY: Record<string, string> = {
  budget: 'subscription:tab.budget',
  general: 'setting:workspaceSetting.tab.general',
  members: 'setting:workspaceSetting.tab.members',
};

interface SettingsRouteHandle {
  settingsTab?: SettingsTabs;
}

const getSettingsTabFromMatches = (matches: ReturnType<typeof useMatches>) => {
  for (const match of [...matches].reverse()) {
    const handle = match.handle as SettingsRouteHandle | undefined;
    if (handle?.settingsTab) return handle.settingsTab;
  }
};

const Header = memo(() => {
  const { t } = useTranslation(['setting', 'auth', 'labs', 'subscription']);
  const navigate = useWorkspaceAwareNavigate();
  const params = useParams<{ providerId?: string; tab?: string }>();
  const matches = useMatches();
  const [searchParams] = useSearchParams();
  const workspaceSettingsMatch = useMatch('/:workspaceSlug/settings/:workspaceTab/*');

  // Personal provider details carry the id in the path; the workspace provider
  // page canonicalizes it into the `provider` query param instead.
  const queryProvider = searchParams.get('provider');
  const providerId =
    params.providerId ?? (queryProvider && queryProvider !== 'all' ? queryProvider : undefined);
  const isProvider = providerId && providerId !== 'all';

  const handleBackClick = () => {
    const workspaceSlug = workspaceSettingsMatch?.params.workspaceSlug;
    if (workspaceSlug && isProvider) {
      // Workspace provider details are query-selected; stay inside the same
      // workspace and return to its provider list.
      navigate('/settings/provider');
    } else if (workspaceSlug) {
      navigate(`/${workspaceSlug}`, { escape: true });
    } else if (params.providerId && params.providerId !== 'all') {
      navigate('/settings/provider/all', { escape: true });
    } else if (isProvider) {
      // Query-selected provider (workspace form): back to the workspace
      // provider list instead of escaping to personal settings.
      navigate('/settings/provider');
    } else {
      navigate('/me/settings', { escape: true });
    }
  };

  const workspaceTab = workspaceSettingsMatch?.params.workspaceTab;
  const tab = (params.tab ?? workspaceTab ?? getSettingsTabFromMatches(matches)) as
    SettingsTabs | undefined;
  const tabTitleKey = tab
    ? (WORKSPACE_TAB_TITLE_KEY[workspaceTab ?? ''] ?? TAB_TITLE_KEY[tab] ?? `setting:tab.${tab}`)
    : 'setting:tab.all';
  // i18next's strict key union rejects dynamic strings. `Parameters<typeof t>[0]` would push TS
  // onto the wrong overload and infer the return as `unknown`, so we fall back to `as any`.
  // Unknown keys surface visibly as raw text, which is acceptable.
  const tabTitle = t(tabTitleKey as any);

  return (
    <ChatHeader
      style={{ ...mobileHeaderSticky, flex: 'none', position: 'relative' }}
      center={
        <ChatHeader.Title
          title={
            <Flexbox horizontal align={'center'} gap={8}>
              <span style={{ lineHeight: 1.2 }}>{isProvider ? providerId : tabTitle}</span>
            </Flexbox>
          }
        />
      }
      left={
        <ActionIcon
          aria-label={t('back', { ns: 'common' })}
          icon={ChevronLeft}
          size={MOBILE_HEADER_ICON_SIZE}
          title={t('back', { ns: 'common' })}
          onClick={handleBackClick}
        />
      }
    />
  );
});

export default Header;
