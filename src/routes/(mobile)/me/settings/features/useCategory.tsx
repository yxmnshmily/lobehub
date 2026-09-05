import { Avatar } from '@lobehub/ui/base-ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import {
  AppWindowIcon,
  Blocks,
  Brain,
  BrainCircuit,
  ChartColumnBigIcon,
  Coins,
  CreditCard,
  Database,
  EllipsisIcon,
  FileClock,
  FolderKanban,
  Gift,
  Info,
  KeyIcon,
  KeyRound,
  Map,
  PaletteIcon,
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
  key: SettingsTabs;
}

export interface CategoryGroup {
  items: CategoryItem[];
  key: SettingsGroupKey;
  title: string;
}

export const useCategory = (): CategoryGroup[] => {
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
    const makeItem = (item: Omit<CategoryItem, 'onClick'>, path?: string): CategoryItem => ({
      ...item,
      onClick: () =>
        navigate(
          path ||
            (item.key === SettingsTabs.Provider
              ? '/settings/provider/all'
              : `/settings/${item.key}`),
          { escape: true },
        ),
    });

    const customerGroups: CategoryGroup[] = [
      {
        items: [
          makeItem({
            icon: avatar ? <Avatar avatar={avatar} shape={'square'} size={26} /> : UserCircle,
            key: SettingsTabs.Profile,
            label: username || '头像与账户',
          }),
          makeItem({ icon: ShieldCheck, key: SettingsTabs.Security, label: '密码与安全' }),
        ],
        key: SettingsGroupKey.Account,
        title: '账户',
      },
      {
        items: [
          makeItem({ icon: Coins, key: SettingsTabs.Credits, label: 'Credits 余额' }),
          makeItem({
            icon: FileClock,
            key: SettingsTabs.Billing,
            label: 'Credits 明细与服务订单',
          }),
          makeItem(
            { icon: ChartColumnBigIcon, key: SettingsTabs.Usage, label: 'Token 用量' },
            '/settings/credits?section=balance-usage',
          ),
          makeItem(
            { icon: FolderKanban, key: SettingsTabs.Works, label: '本人生成记录' },
            '/settings/credits?section=my-creations',
          ),
        ],
        key: SettingsGroupKey.Service,
        title: '旅行服务',
      },
    ];

    if (isPlatformAdminLoading || !isPlatformAdmin) return customerGroups;

    const general: CategoryItem[] = [
      makeItem({ icon: UserCircle, key: SettingsTabs.Profile, label: t('auth:profile.title') }),
      makeItem({ icon: ChartColumnBigIcon, key: SettingsTabs.Stats, label: t('auth:tab.stats') }),
      makeItem({
        icon: PaletteIcon,
        key: SettingsTabs.Appearance,
        label: t('setting:tab.appearance'),
      }),
    ];
    const subscription: CategoryItem[] = enableBusinessFeatures
      ? [
          makeItem({ icon: Map, key: SettingsTabs.Plans, label: t('subscription:tab.plans') }),
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
            icon: CreditCard,
            key: SettingsTabs.Billing,
            label: t('subscription:tab.billing'),
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
      makeItem({ icon: BrainCircuit, key: SettingsTabs.Memory, label: t('setting:tab.memory') }),
      makeItem({ icon: KeyRound, key: SettingsTabs.Creds, label: t('setting:tab.creds') }),
      showApiKeyManage &&
        makeItem({ icon: KeyIcon, key: SettingsTabs.APIKey, label: t('auth:tab.apikey') }),
    ].filter((item): item is CategoryItem => Boolean(item));
    const system = [
      makeItem({ icon: Database, key: SettingsTabs.Storage, label: t('setting:tab.storage') }),
      isDevMode &&
        makeItem({ icon: KeyIcon, key: SettingsTabs.APIKey, label: t('auth:tab.apikey') }),
      makeItem({
        icon: EllipsisIcon,
        key: SettingsTabs.Advanced,
        label: t('setting:tab.advanced'),
      }),
      !hideDocs && makeItem({ icon: Info, key: SettingsTabs.About, label: t('setting:tab.about') }),
    ].filter((item): item is CategoryItem => Boolean(item));
    const developer = [
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
      { items: developer, key: SettingsGroupKey.Developer, title: t('setting:group.developer') },
      {
        items: [
          makeItem({
            icon: Users,
            key: SettingsTabs.ServiceOperations,
            label: '服务运营 / 客户账户',
          }),
        ],
        key: SettingsGroupKey.Operations,
        title: '旅行服务管理',
      },
    ].filter((group) => group.items.length > 0);
  }, [
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
