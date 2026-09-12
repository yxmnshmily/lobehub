import { isDesktop } from '@lobechat/const';
import { SkillsIcon } from '@lobehub/ui/icons';
import {
  AppWindowIcon,
  BellIcon,
  Blocks,
  Brain,
  ChartColumnBigIcon,
  Coins,
  CreditCard,
  Database,
  EllipsisIcon,
  EthernetPort,
  FlaskConical,
  FolderKanban,
  Gift,
  KeyboardIcon,
  KeyIcon,
  KeyRound,
  MessageCircleIcon,
  MonitorSmartphoneIcon,
  PaletteIcon,
  Shapes,
  ShieldCheck,
  Sparkles,
  TagIcon,
  TerminalSquare,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import { SettingsTabs } from '@/store/global/initialState';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';
import { useTravelTranslation } from '@/utils/i18n/travel';

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
  const translateTravel = useTravelTranslation();
  const { t } = useTranslation('setting');
  const { t: tAuth } = useTranslation('auth');
  const { t: tLabs } = useTranslation('labs');
  const { t: tSubscription } = useTranslation('subscription');
  const { data: isPlatformAdmin, isLoading: isPlatformAdminLoading } =
    lambdaQuery.platformAccess.isPlatformAdmin.useQuery();
  const mobile = useServerConfigStore((s) => s.isMobile);
  const { showApiKeyManage, showProvider } = useServerConfigStore(featureFlagsSelectors);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const enableOAuthApps = useUserStore(labPreferSelectors.enableOAuthApps);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  return useMemo(() => {
    const customerGroups: CategoryGroup[] = [
      {
        items: [
          { icon: BellIcon, key: SettingsTabs.Notification, label: t('tab.notification') },
          { icon: ShieldCheck, key: SettingsTabs.Security, label: translateTravel('密码与安全') },
        ],
        key: SettingsGroupKey.Account,
        title: translateTravel('账户'),
      },
      {
        items: [
          { icon: CreditCard, key: SettingsTabs.Plans, label: translateTravel('套餐') },
          {
            href: '/settings/usage',
            icon: ChartColumnBigIcon,
            key: SettingsTabs.Usage,
            label: translateTravel('用量'),
          },
          { icon: Coins, key: SettingsTabs.Credits, label: translateTravel('积分') },
          {
            href: '/settings/credits?section=my-creations',
            icon: FolderKanban,
            key: SettingsTabs.Works,
            label: translateTravel('本人生成记录'),
          },
        ],
        key: SettingsGroupKey.Service,
        title: translateTravel('套餐费用'),
      },
    ];

    if (isPlatformAdminLoading || !isPlatformAdmin) return customerGroups;

    const groups: CategoryGroup[] = [];
    const generalItems: CategoryItem[] = [
      { icon: PaletteIcon, key: SettingsTabs.Appearance, label: t('tab.appearance') },
      { icon: MonitorSmartphoneIcon, key: SettingsTabs.Devices, label: t('tab.devices') },
      !mobile && { icon: KeyboardIcon, key: SettingsTabs.Hotkey, label: t('tab.hotkey') },
      {
        icon: BellIcon,
        key: SettingsTabs.Notification,
        label: t('tab.notification'),
      },
    ].filter(Boolean) as CategoryItem[];
    groups.push({ items: generalItems, key: SettingsGroupKey.General, title: t('group.common') });

    if (enableBusinessFeatures) {
      groups.push({
        items: [
          { icon: CreditCard, key: SettingsTabs.Plans, label: tSubscription('tab.plans') },
          { icon: ChartColumnBigIcon, key: SettingsTabs.Usage, label: t('tab.usage') },
          { icon: Coins, key: SettingsTabs.Credits, label: tSubscription('tab.credits') },
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
        {
          href: '/community',
          icon: Shapes,
          key: SettingsTabs.Community,
          label: t('tab.community', { ns: 'common' }),
        },
        { icon: MessageCircleIcon, key: SettingsTabs.Messenger, label: t('tab.messenger') },
      ].filter(Boolean) as CategoryItem[],
      key: SettingsGroupKey.Agent,
      title: t('group.aiConfig'),
    });

    groups.push({
      items: [
        {
          icon: EllipsisIcon,
          key: SettingsTabs.Advanced,
          label: t('tab.advanced.toolsAndDiagnostics.title'),
        },
        { icon: KeyRound, key: SettingsTabs.Creds, label: t('tab.creds') },
        (showApiKeyManage || isDevMode) && {
          icon: KeyIcon,
          key: SettingsTabs.APIKey,
          label: tAuth('tab.apikey'),
        },
        enableOAuthApps && {
          icon: AppWindowIcon,
          key: SettingsTabs.OAuthApps,
          label: tAuth('tab.oauthApps'),
        },
        { icon: FlaskConical, key: SettingsTabs.Labs, label: tLabs('title') },
        { icon: Database, key: SettingsTabs.Storage, label: t('tab.storage') },
        isDesktop && { icon: EthernetPort, key: SettingsTabs.Proxy, label: t('tab.proxy') },
        isDesktop && {
          icon: TerminalSquare,
          key: SettingsTabs.SystemTools,
          label: t('tab.systemTools'),
        },
      ].filter(Boolean) as CategoryItem[],
      key: SettingsGroupKey.Developer,
      title: t('tab.advanced'),
    });

    groups.push({
      items: [
        {
          href: '/settings/content-moderation',
          icon: ShieldCheck,
          key: SettingsTabs.ContentModeration,
          label: translateTravel('内容审核'),
        },
        {
          href: '/settings/service-operations',
          icon: Users,
          key: SettingsTabs.ServiceOperations,
          label: translateTravel('账户管理'),
        },
      ],
      key: SettingsGroupKey.Operations,
      title: translateTravel('用户后台管理'),
    });

    return groups;
  }, [
    translateTravel,
    enableBusinessFeatures,
    enableOAuthApps,
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
  ]);
};
