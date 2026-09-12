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
  FolderKanban,
  Gift,
  Info,
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
  UserCircle,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type CellProps } from '@/components/Cell';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { lambdaQuery } from '@/libs/trpc/client';
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

export interface CategoryItem extends Omit<CellProps, 'type'> {
  href: string;
  key: SettingsTabs;
}

export interface CategoryGroup {
  items: CategoryItem[];
  key: SettingsGroupKey;
  title: string;
}

export const useCategory = (): CategoryGroup[] => {
  const translateTravel = useTravelTranslation();
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation(['setting', 'auth', 'subscription']);
  const { data: isPlatformAdmin, isLoading: isPlatformAdminLoading } =
    lambdaQuery.platformAccess.isPlatformAdmin.useQuery();
  const { hideDocs, showApiKeyManage, showProvider } = useServerConfigStore(featureFlagsSelectors);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const [avatar, username] = useUserStore((s) => [
    userProfileSelectors.userAvatar(s),
    userProfileSelectors.nickName(s),
  ]);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const enableOAuthApps = useUserStore(labPreferSelectors.enableOAuthApps);

  return useMemo(() => {
    const makeItem = (
      item: Omit<CategoryItem, 'href' | 'onClick'>,
      path?: string,
    ): CategoryItem => {
      const href =
        path ||
        (item.key === SettingsTabs.Provider ? '/settings/provider/all' : `/settings/${item.key}`);

      return {
        ...item,
        href,
        onClick: () => navigate(href, { escape: true }),
      };
    };

    const customerGroups: CategoryGroup[] = [
      {
        items: [
          makeItem({
            icon: avatar ? <Avatar avatar={avatar} shape={'square'} size={26} /> : UserCircle,
            key: SettingsTabs.Profile,
            label: username || translateTravel('头像与账户'),
          }),
          makeItem({
            icon: ShieldCheck,
            key: SettingsTabs.Security,
            label: translateTravel('密码与安全'),
          }),
        ],
        key: SettingsGroupKey.Account,
        title: translateTravel('账户'),
      },
      {
        items: [
          makeItem({ icon: Coins, key: SettingsTabs.Credits, label: translateTravel('积分余额') }),
          makeItem(
            {
              icon: ChartColumnBigIcon,
              key: SettingsTabs.Usage,
              label: translateTravel('账户用量'),
            },
            '/settings/usage',
          ),
          makeItem(
            { icon: FolderKanban, key: SettingsTabs.Works, label: translateTravel('本人生成记录') },
            '/settings/credits?section=my-creations',
          ),
        ],
        key: SettingsGroupKey.Service,
        title: translateTravel('套餐费用'),
      },
    ];

    if (isPlatformAdminLoading || !isPlatformAdmin) return customerGroups;

    const general: CategoryItem[] = [
      makeItem({
        icon: PaletteIcon,
        key: SettingsTabs.Appearance,
        label: t('setting:tab.appearance'),
      }),
      makeItem({
        icon: MonitorSmartphoneIcon,
        key: SettingsTabs.Devices,
        label: t('setting:tab.devices'),
      }),
      makeItem({ icon: KeyboardIcon, key: SettingsTabs.Hotkey, label: t('setting:tab.hotkey') }),
      makeItem({
        icon: BellIcon,
        key: SettingsTabs.Notification,
        label: t('setting:tab.notification'),
      }),
    ];
    const subscription: CategoryItem[] = enableBusinessFeatures
      ? [
          makeItem({
            icon: CreditCard,
            key: SettingsTabs.Plans,
            label: t('subscription:tab.plans'),
          }),
          makeItem({
            icon: ChartColumnBigIcon,
            key: SettingsTabs.Usage,
            label: t('setting:tab.usage'),
          }),
          makeItem({
            icon: Coins,
            key: SettingsTabs.Credits,
            label: t('subscription:tab.credits'),
          }),
          makeItem({
            icon: Gift,
            key: SettingsTabs.Referral,
            label: t('subscription:tab.referral'),
          }),
        ]
      : [];
    const agent = [
      showProvider &&
        makeItem({ icon: Brain, key: SettingsTabs.Provider, label: t('setting:tab.provider') }),
      makeItem({
        icon: Sparkles,
        key: SettingsTabs.ServiceModel,
        label: t('setting:tab.serviceModel'),
      }),
      makeItem({ icon: SkillsIcon, key: SettingsTabs.Skill, label: t('setting:tab.skill') }),
      makeItem({ icon: TagIcon, key: SettingsTabs.Labels, label: t('setting:tab.labels') }),
      makeItem({ icon: Blocks, key: SettingsTabs.Connector, label: t('setting:tab.connector') }),
      makeItem(
        { icon: Shapes, key: SettingsTabs.Community, label: t('tab.community', { ns: 'common' }) },
        '/community',
      ),
      makeItem({
        icon: MessageCircleIcon,
        key: SettingsTabs.Messenger,
        label: t('setting:tab.messenger'),
      }),
      makeItem({ icon: BrainCircuit, key: SettingsTabs.Memory, label: t('setting:tab.memory') }),
    ].filter((item): item is CategoryItem => Boolean(item));
    const system = [
      !hideDocs && makeItem({ icon: Info, key: SettingsTabs.About, label: t('setting:tab.about') }),
    ].filter((item): item is CategoryItem => Boolean(item));
    const developer = [
      makeItem({
        icon: EllipsisIcon,
        key: SettingsTabs.Advanced,
        label: t('setting:tab.advanced.toolsAndDiagnostics.title'),
      }),
      makeItem({ icon: KeyRound, key: SettingsTabs.Creds, label: t('setting:tab.creds') }),
      (showApiKeyManage || isDevMode) &&
        makeItem({ icon: KeyIcon, key: SettingsTabs.APIKey, label: t('auth:tab.apikey') }),
      makeItem({ icon: Database, key: SettingsTabs.Storage, label: t('setting:tab.storage') }),
      enableOAuthApps &&
        makeItem({
          icon: AppWindowIcon,
          key: SettingsTabs.OAuthApps,
          label: t('auth:tab.oauthApps'),
        }),
    ].filter((item): item is CategoryItem => Boolean(item));

    return [
      { items: general, key: SettingsGroupKey.General, title: t('setting:group.common') },
      {
        items: subscription,
        key: SettingsGroupKey.Subscription,
        title: t('setting:group.subscription'),
      },
      { items: agent, key: SettingsGroupKey.Agent, title: t('setting:group.aiConfig') },
      { items: system, key: SettingsGroupKey.System, title: t('setting:group.system') },
      { items: developer, key: SettingsGroupKey.Developer, title: t('setting:tab.advanced') },
      {
        items: [
          makeItem({
            icon: ShieldCheck,
            key: SettingsTabs.ContentModeration,
            label: translateTravel('内容审核'),
          }),
          makeItem({
            icon: Users,
            key: SettingsTabs.ServiceOperations,
            label: translateTravel('账户管理'),
          }),
        ],
        key: SettingsGroupKey.Operations,
        title: translateTravel('用户后台管理'),
      },
    ].filter((group) => group.items.length > 0);
  }, [
    translateTravel,
    avatar,
    enableBusinessFeatures,
    enableOAuthApps,
    hideDocs,
    isDevMode,
    isPlatformAdmin,
    isPlatformAdminLoading,
    navigate,
    showApiKeyManage,
    showProvider,
    t,
    username,
  ]);
};
