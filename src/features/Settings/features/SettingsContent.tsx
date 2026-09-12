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

/** 个别设置页的内容留白覆盖（其余页面统一 48）；left 用于只改左侧 */
const CONTENT_PADDING_BY_TAB: Partial<
  Record<SettingsTabs, { block: number; inline: number; left?: number }>
> = {
  /* 只保留 SettingsTabs 里真实存在的枚举成员（All 不存在，已删除；Skill 由下面的字符串键覆盖） */
  [SettingsTabs.Provider]: { block: 24, inline: 24 },
};

/** 按 componentMap 的字符串键覆盖（枚举键与页面键不一定同名，字符串键最可靠） */
const CONTENT_PADDING_BY_KEY: Record<string, { block: number; inline: number; left?: number }> = {
  ['stats']: { block: 16, inline: 48 },

  ['stats']: { block: 16, inline: 48 },

  ['stats']: { block: 0, inline: 48 },

  ['connector']: { block: 48, inline: 48, left: 4 },

  ['connector']: { block: 48, inline: 8 },

  ['connector']: { block: 4, inline: 48 },

  ['connector']: { block: 48, inline: 48 },

  ['connector']: { block: 48, inline: 48, left: 48 },

  ['all']: { block: 48, inline: 48, left: 12 },

  ['all']: { block: 48, inline: 48, left: 24 },

  ['all']: { block: 24, inline: 48 },

  ['all']: { block: 48, inline: 24 },

  ['all']: { block: 24, inline: 48 },

  ['profile']: { block: 48, inline: 48 },

  ['usage']: { block: 48, inline: 48 },

  ['service-operations']: { block: 48, inline: 48, left: 0 },

  ['service-operations']: { block: 0, inline: 48 },

  ['service-operations']: { block: 48, inline: 0 },

  ['service-operations']: { block: 0, inline: 48 },

  ['service-operations']: { block: 48, inline: 48, left: 0 },

  ['service-operations']: { block: 0, inline: 48 },

  ['service-operations']: { block: 48, inline: 0 },

  ['service-operations']: { block: 0, inline: 48 },

  ['service-operations']: { block: 48, inline: 48, left: 0 },

  ['service-operations']: { block: 0, inline: 48 },

  ['service-operations']: { block: 48, inline: 0 },

  ['service-operations']: { block: 0, inline: 48 },

  ['content-moderation']: { block: 48, inline: 48, left: 0 },

  ['content-moderation']: { block: 0, inline: 48 },

  ['content-moderation']: { block: 48, inline: 0 },

  ['content-moderation']: { block: 0, inline: 48 },

  ['stats']: { block: 16, inline: 48 },

  ['stats']: { block: 16, inline: 48 },

  ['stats']: { block: 0, inline: 48 },

  ['connector']: { block: 48, inline: 48, left: 4 },

  ['connector']: { block: 48, inline: 8 },

  ['connector']: { block: 4, inline: 48 },

  ['connector']: { block: 48, inline: 48 },

  ['connector']: { block: 48, inline: 48, left: 48 },

  ['all']: { block: 48, inline: 48, left: 12 },

  ['all']: { block: 48, inline: 48, left: 24 },

  ['all']: { block: 24, inline: 48 },

  ['all']: { block: 48, inline: 24 },

  ['all']: { block: 24, inline: 48 },

  ['profile']: { block: 48, inline: 48 },

  ['usage']: { block: 48, inline: 48 },

  ['service-operations']: { block: 48, inline: 48, left: 0 },

  ['service-operations']: { block: 0, inline: 48 },

  ['service-operations']: { block: 48, inline: 0 },

  ['service-operations']: { block: 0, inline: 48 },

  ['service-operations']: { block: 48, inline: 48, left: 0 },

  ['service-operations']: { block: 0, inline: 48 },

  ['service-operations']: { block: 48, inline: 0 },

  ['service-operations']: { block: 0, inline: 48 },

  ['service-operations']: { block: 48, inline: 48, left: 0 },

  ['service-operations']: { block: 0, inline: 48 },

  ['service-operations']: { block: 48, inline: 0 },

  ['service-operations']: { block: 0, inline: 48 },

  ['content-moderation']: { block: 48, inline: 48, left: 0 },

  ['content-moderation']: { block: 0, inline: 48 },

  ['content-moderation']: { block: 48, inline: 0 },

  ['content-moderation']: { block: 0, inline: 48 },

  /* 技能页：左侧内边距 24px（其余保持 48） */
  skill: { block: 48, inline: 48, left: 48 },
};

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
    <Flexbox
      data-settings-content="deepseek"
      flex={1}
      height={'100%'}
      style={{ minHeight: 0, minWidth: 0, overflow: 'hidden' }}
    >
      {Object.keys(componentMap).map((tabKey) => {
        if (resolvedTab !== tabKey) return null;
        const content = renderComponent(tabKey);
        // One shared container for every settings tab; no page title bar, so
        // the content itself starts on the 48px line. 个别页面按需求单独给留白。
        const pad =
          CONTENT_PADDING_BY_KEY[String(tabKey)] ?? CONTENT_PADDING_BY_TAB[tabKey as SettingsTabs];
        return (
          <Fragment key={tabKey}>
            <SettingContainer
              gap={32}
              maxWidth={'100%'}
              paddingBlock={pad?.block ?? 48}
              /* 有 left 覆盖时不能传 paddingInline prop：SettingContainer 内部 {...rest} 在 style 之后展开，会把 style 里的 paddingLeft 盖掉 */
              paddingInline={pad?.left === undefined ? (pad?.inline ?? 48) : undefined}
              style={
                pad?.left === undefined
                  ? undefined
                  : { paddingInline: pad.inline, paddingLeft: pad.left }
              }
            >
              {content}
            </SettingContainer>
          </Fragment>
        );
      })}
    </Flexbox>
  );
};

export default SettingsContent;
