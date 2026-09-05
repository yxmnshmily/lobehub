import { isDesktop } from '@lobechat/const';
import { Avatar } from '@lobehub/ui/base-ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import {
  AppWindowIcon,
  BellIcon,
  Blocks,
  Brain,
  BrainCircuit,
  ChartColumnBigIcon,
  Coins,
  CreditCard,
  Database,
  EllipsisIcon,
  EthernetPort,
  FileClock,
  FlaskConical,
  FolderKanban,
  Gift,
  Info,
  KeyboardIcon,
  KeyIcon,
  KeyRound,
  Map,
  MessageCircleIcon,
  MonitorSmartphoneIcon,
  PaletteIcon,
  ShieldCheck,
  Sparkles,
  TagIcon,
  TerminalSquare,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { SettingsTabs } from '@/store/global/initialState';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

export enum SettingsGroupKey {
  Account = 'account',
  Agent = 'agent',
  Developer = 'developer',
  General = 'general',
  Operations = 'operations',
  Service = 'service',
  Subscription = 'subscription',
  System = 'system',
}

export interface CategoryItem {
  /** Override the navigation URL. When omitted, Body derives the URL from `key`. */
  href?: string;
  icon: any;
  key: SettingsTabs;
  label: string;
}

export interface CategoryGroup {
  items: CategoryItem[];
  key: SettingsGroupKey;
  title: string;
}

export const useCategory = (): CategoryGroup[] => {
  const { t } = useTranslation('setting');
  const { t: tAuth } = useTranslation('auth');
  const { t: tLabs } = useTranslation('labs');
  const { t: tSubscription } = useTranslation('subscription');
  const { data: isPlatformAdmin, isLoading: isPlatformAdminLoading } =
    lambdaQuery.platformAccess.isPlatformAdmin.useQuery();
  const mobile = useServerConfigStore((s) => s.isMobile);
  const { hideDocs, showApiKeyManage, showProvider } = useServerConfigStore(featureFlagsSelectors);
  const [avatar, username] = useUserStore((s) => [
    userProfileSelectors.userAvatar(s),
    userProfileSelectors.nickName(s),
  ]);
  const remoteServerUrl = useElectronStore(electronSyncSelectors.remoteServerUrl);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const enableOAuthApps = useUserStore(labPreferSelectors.enableOAuthApps);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  const avatarUrl = useMemo(() => {
    if (!avatar) return undefined;
    if (isDesktop && avatar.startsWith('/') && remoteServerUrl) return remoteServerUrl + avatar;
    return avatar;
  }, [avatar, remoteServerUrl]);

  return useMemo(() => {
    const customerGroups: CategoryGroup[] = [
      {
        items: [
          {
            icon: avatarUrl ? <Avatar avatar={avatarUrl} shape={'square'} size={26} /> : undefined,
            key: SettingsTabs.Profile,
            label: username || tAuth('tab.profile'),
          },
          { icon: ShieldCheck, key: SettingsTabs.Security, label: '密码与安全' },
        ],
        key: SettingsGroupKey.Account,
        title: '账户',
      },
      {
        items: [
          { icon: Coins, key: SettingsTabs.Credits, label: 'Credits 余额' },
          { icon: FileClock, key: SettingsTabs.Billing, label: 'Credits 明细与服务订单' },
          {
            href: '/settings/credits?section=balance-usage',
            icon: ChartColumnBigIcon,
            key: SettingsTabs.Usage,
            label: 'Token 用量',
          },
          {
            href: '/settings/credits?section=my-creations',
            icon: FolderKanban,
            key: SettingsTabs.Works,
            label: '本人生成记录',
          },
        ],
        key: SettingsGroupKey.Service,
        title: '旅行服务',
      },
    ];

    if (isPlatformAdminLoading || !isPlatformAdmin) return customerGroups;

    const groups: CategoryGroup[] = [];
    const generalItems: CategoryItem[] = [
      {
        icon: avatarUrl ? <Avatar avatar={avatarUrl} shape={'square'} size={26} /> : undefined,
        key: SettingsTabs.Profile,
        label: username || tAuth('tab.profile'),
      },
      { icon: ChartColumnBigIcon, key: SettingsTabs.Stats, label: tAuth('tab.stats') },
      { icon: PaletteIcon, key: SettingsTabs.Appearance, label: t('tab.appearance') },
      { icon: MonitorSmartphoneIcon, key: SettingsTabs.Devices, label: t('tab.devices') },
      !mobile && { icon: KeyboardIcon, key: SettingsTabs.Hotkey, label: t('tab.hotkey') },
      enableBusinessFeatures && {
        icon: BellIcon,
        key: SettingsTabs.Notification,
        label: t('tab.notification'),
      },
    ].filter(Boolean) as CategoryItem[];
    groups.push({ items: generalItems, key: SettingsGroupKey.General, title: t('group.common') });

    if (enableBusinessFeatures) {
      groups.push({
        items: [
          { icon: Map, key: SettingsTabs.Plans, label: tSubscription('tab.plans') },
          { icon: ChartColumnBigIcon, key: SettingsTabs.Usage, label: t('tab.usage') },
          { icon: Coins, key: SettingsTabs.Credits, label: tSubscription('tab.credits') },
          { icon: CreditCard, key: SettingsTabs.Billing, label: tSubscription('tab.billing') },
          { icon: Gift, key: SettingsTabs.Referral, label: tSubscription('tab.referral') },
        ],
        key: SettingsGroupKey.Subscription,
        title: t('group.subscription'),
      });
    }

    groups.push({
      items: [
        showProvider && { icon: Brain, key: SettingsTabs.Provider, label: t('tab.provider') },
        { icon: Sparkles, key: SettingsTabs.ServiceModel, label: t('tab.serviceModel') },
        { icon: SkillsIcon, key: SettingsTabs.Skill, label: t('tab.skill') },
        { icon: TagIcon, key: SettingsTabs.Labels, label: t('tab.labels') },
        { icon: Blocks, key: SettingsTabs.Connector, label: t('tab.connector') },
        { icon: BrainCircuit, key: SettingsTabs.Memory, label: t('tab.memory') },
        { icon: KeyRound, key: SettingsTabs.Creds, label: t('tab.creds') },
        showApiKeyManage && { icon: KeyIcon, key: SettingsTabs.APIKey, label: tAuth('tab.apikey') },
        { icon: MessageCircleIcon, key: SettingsTabs.Messenger, label: t('tab.messenger') },
      ].filter(Boolean) as CategoryItem[],
      key: SettingsGroupKey.Agent,
      title: t('group.aiConfig'),
    });

    groups.push({
      items: [
        isDesktop && { icon: EthernetPort, key: SettingsTabs.Proxy, label: t('tab.proxy') },
        isDesktop && {
          icon: TerminalSquare,
          key: SettingsTabs.SystemTools,
          label: t('tab.systemTools'),
        },
        { icon: Database, key: SettingsTabs.Storage, label: t('tab.storage') },
        !hideDocs && { icon: Info, key: SettingsTabs.About, label: t('tab.about') },
      ].filter(Boolean) as CategoryItem[],
      key: SettingsGroupKey.System,
      title: t('group.system'),
    });

    groups.push({
      items: [
        { icon: EllipsisIcon, key: SettingsTabs.Advanced, label: t('tab.advanced') },
        isDevMode && { icon: KeyIcon, key: SettingsTabs.APIKey, label: tAuth('tab.apikey') },
        enableOAuthApps && {
          icon: AppWindowIcon,
          key: SettingsTabs.OAuthApps,
          label: tAuth('tab.oauthApps'),
        },
        { icon: FlaskConical, key: SettingsTabs.Labs, label: tLabs('title') },
      ].filter(Boolean) as CategoryItem[],
      key: SettingsGroupKey.Developer,
      title: t('group.developer'),
    });

    groups.push({
      items: [
        {
          href: '/settings/service-operations',
          icon: Users,
          key: SettingsTabs.ServiceOperations,
          label: '服务运营 / 客户账户',
        },
      ],
      key: SettingsGroupKey.Operations,
      title: '旅行服务管理',
    });

    return groups;
  }, [
    avatarUrl,
    enableBusinessFeatures,
    enableOAuthApps,
    hideDocs,
    isDevMode,
    isPlatformAdmin,
    isPlatformAdminLoading,
    mobile,
    showApiKeyManage,
    showProvider,
    t,
    tAuth,
    tLabs,
    tSubscription,
    username,
  ]);
};
