'use client';

import { Flexbox } from '@lobehub/ui';
import { Fragment, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import SettingContainer from '@/features/Setting/SettingContainer';
import { useSettingsAnchorScroll } from '@/features/SettingsSearch/anchor';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { lambdaQuery } from '@/libs/trpc/client';
import { SettingsTabs } from '@/store/global/initialState';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useTravelTranslation } from '@/utils/i18n/travel';

import { componentMap } from './componentMap';

/* 统一边距规格已下沉到 SettingContainer 共享组件（桌面 48px / 手机 10px，
   内层填充归零），此处只需传桌面端的值。 */

const REDIRECT_MAP: Record<string, string> = {
  [SettingsTabs.Common]: SettingsTabs.Appearance,
  [SettingsTabs.ChatAppearance]: SettingsTabs.Appearance,
  [SettingsTabs.Agent]: SettingsTabs.ServiceModel,
  [SettingsTabs.TTS]: SettingsTabs.ServiceModel,
  [SettingsTabs.Image]: SettingsTabs.ServiceModel,
};

const CUSTOMER_SETTINGS_TABS = new Set<string>([
  SettingsTabs.Notification,
  SettingsTabs.Plans,
  SettingsTabs.Billing,
  SettingsTabs.Credits,
  SettingsTabs.Profile,
  SettingsTabs.Security,
  SettingsTabs.Usage,
]);

const COMPACT_HEADER_TABS = [
  SettingsTabs.About,
  SettingsTabs.Advanced,
  SettingsTabs.OAuthApps,
  SettingsTabs.Proxy,
  SettingsTabs.SystemTools,
  SettingsTabs.APIKey,
  SettingsTabs.Appearance,
  SettingsTabs.Billing,
  SettingsTabs.Credits,
  SettingsTabs.Devices,
  SettingsTabs.Hotkey,
  SettingsTabs.Labels,
  SettingsTabs.Labs,
  SettingsTabs.Memory,
  SettingsTabs.Messenger,
  SettingsTabs.Notification,
  SettingsTabs.Plans,
  SettingsTabs.Profile,
  SettingsTabs.Referral,
  SettingsTabs.ServiceModel,
  SettingsTabs.Stats,
  SettingsTabs.Storage,
] as const;

interface SettingsContentProps {
  activeTab?: string;
  mobile?: boolean;
}

const SettingsContent = ({ mobile, activeTab }: SettingsContentProps) => {
  const translateTravel = useTravelTranslation();
  const { t } = useTranslation(['auth', 'labs', 'setting', 'subscription']);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const navigate = useWorkspaceAwareNavigate();
  const { data: isPlatformAdmin, isLoading: isPlatformAdminLoading } =
    lambdaQuery.platformAccess.isPlatformAdmin.useQuery();
  const isKnownSettingsTab =
    !activeTab || activeTab in componentMap || Object.hasOwn(REDIRECT_MAP, activeTab);
  const resolvedTab = isKnownSettingsTab ? activeTab : SettingsTabs.Profile;
  const isCustomerSettingsTab = !resolvedTab || CUSTOMER_SETTINGS_TABS.has(resolvedTab);

  useSettingsAnchorScroll();

  useEffect(() => {
    if (!activeTab || isPlatformAdminLoading) return;

    if (!isKnownSettingsTab) {
      navigate('/settings/profile', { escape: true, replace: true });
      return;
    }

    if (!isPlatformAdmin && !isCustomerSettingsTab) {
      navigate('/settings/profile', { escape: true, replace: true });
      return;
    }

    if (isPlatformAdmin && REDIRECT_MAP[activeTab]) {
      // Personal-only redirect: legacy URL aliases (common, agent, tts, image,
      // chat-appearance) map to personal-settings tabs. `escape: true` keeps the
      // user in personal context even when a workspace happens to be active.
      navigate(`/settings/${REDIRECT_MAP[activeTab]}`, { escape: true, replace: true });
    }
  }, [
    activeTab,
    isCustomerSettingsTab,
    isKnownSettingsTab,
    isPlatformAdmin,
    isPlatformAdminLoading,
    navigate,
  ]);

  const renderComponent = (tab: string) => {
    const Component = componentMap[tab as keyof typeof componentMap] || componentMap.appearance;
    if (!Component) return null;

    const componentProps: { mobile?: boolean; showSettingHeader?: boolean } = {};
    if (COMPACT_HEADER_TABS.includes(tab as (typeof COMPACT_HEADER_TABS)[number])) {
      componentProps.showSettingHeader =
        !!mobile &&
        [
          SettingsTabs.Advanced,
          SettingsTabs.OAuthApps,
          SettingsTabs.Proxy,
          SettingsTabs.SystemTools,
        ].includes(tab as SettingsTabs);
    }
    if (
      [
        SettingsTabs.About,
        SettingsTabs.ServiceModel,
        SettingsTabs.Provider,
        SettingsTabs.Skill,
        SettingsTabs.Connector,
        SettingsTabs.Profile,
        SettingsTabs.Stats,
        SettingsTabs.Usage,
        SettingsTabs.Creds,
        SettingsTabs.Security,
        ...(enableBusinessFeatures
          ? [SettingsTabs.Plans, SettingsTabs.Credits, SettingsTabs.Billing, SettingsTabs.Referral]
          : []),
      ].includes(tab as any)
    ) {
      componentProps.mobile = mobile;
    }

    return <Component {...componentProps} />;
  };

  if (!isCustomerSettingsTab && (isPlatformAdminLoading || !isPlatformAdmin)) return null;
  if (activeTab && isPlatformAdmin && REDIRECT_MAP[activeTab]) return null;

  if (mobile) {
    return resolvedTab ? renderComponent(resolvedTab) : renderComponent(SettingsTabs.Profile);
  }

  return (
    <Flexbox data-settings-content="deepseek" style={{ minWidth: 0 }}>
      {Object.keys(componentMap).map((tabKey) => {
        if (resolvedTab !== tabKey) return null;
        const content = renderComponent(tabKey);
        return (
          <Fragment key={tabKey}>
            <SettingContainer gap={32} maxWidth={'100%'} paddingBlock={48} paddingInline={48}>
              {content}
            </SettingContainer>
          </Fragment>
        );
      })}
    </Flexbox>
  );
};

export default SettingsContent;
