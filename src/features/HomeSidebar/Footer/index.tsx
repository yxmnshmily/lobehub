'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { useAnalytics } from '@lobehub/analytics/react';
import { type MenuProps } from '@lobehub/ui';
import { DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { DiscordIcon, GithubIcon } from '@lobehub/ui/icons';
import {
  Book,
  ChartColumnBigIcon,
  CircleHelp,
  Download,
  Feather,
  FileClockIcon,
  FlaskConical,
  Info,
  Send,
  Settings2,
  SettingsIcon,
  UserRound,
} from 'lucide-react';
import { memo, type MouseEvent, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { openChangelogModal } from '@/components/ChangelogModal';
import { openFeedbackModal } from '@/components/FeedbackModal';
import { getRouteById } from '@/config/routes';
import { DOCUMENTS_REFER_URL, GITHUB } from '@/const/url';
import Billboard from '@/features/Billboard';
import { useBillboardMenuItems } from '@/features/Billboard/MenuItems';
import { useActiveNavKey } from '@/features/NavPanel/useActiveNavKey';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useNavLayout } from '@/hooks/useNavLayout';
import { lambdaQuery } from '@/libs/trpc/client';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors/general';
import { useTravelTranslation } from '@/utils/i18n/travel';

type FooterMenuItems = NonNullable<MenuProps['items']>;

/**
 * Wrap each clickable menu item with a unified click tracker, preserving any
 * existing onClick. Skips dividers and items without a key. Used to measure
 * which footer menu entries get clicked (breakdown by `key`).
 */
const injectMenuTracking = (
  items: FooterMenuItems,
  track: (key: string) => void,
): FooterMenuItems =>
  items.map((item) => {
    if (!item || (item as { type?: string }).type === 'divider') return item;
    const key = (item as { key?: string | number }).key;
    if (!key) return item;
    const originalOnClick = (item as { onClick?: (info: unknown) => void }).onClick;
    return {
      ...item,
      onClick: (info: unknown) => {
        track(String(key));
        originalOnClick?.(info);
      },
    };
  });

/**
 * Collect the keys of click-trackable items — the exact same set wrapped by
 * `injectMenuTracking` (non-divider items with a key). Used so the menu-open
 * exposure event reports only keys that can later emit `home_footer_menu_clicked`,
 * keeping per-key CTR denominators and numerators aligned. Billboard items are
 * excluded here (they emit their own `billboard_*` events).
 */
const collectMenuKeys = (items: FooterMenuItems): string[] =>
  items
    .filter((item) => item && (item as { type?: string }).type !== 'divider')
    .map((item) => (item as { key?: string | number }).key)
    .filter((key): key is string | number => Boolean(key))
    .map(String);

const Footer = memo(() => {
  const translateTravel = useTravelTranslation();
  const { t } = useTranslation('common');
  const { t: tAuth } = useTranslation('auth');
  const { t: tSetting } = useTranslation('setting');
  const { hideDocs } = useServerConfigStore(featureFlagsSelectors);
  const { analytics } = useAnalytics();
  const { footer } = useNavLayout();
  const isLogin = useUserStore(authSelectors.isLogin);
  const { data: isPlatformAdmin } = lambdaQuery.platformAccess.isPlatformAdmin.useQuery(undefined, {
    enabled: !!isLogin,
    retry: false,
  });
  const hasActiveWorkspace = useHasActiveWorkspace();
  const settingsHref = hasActiveWorkspace
    ? '/settings/general'
    : isPlatformAdmin
      ? '/settings/appearance'
      : '/settings/profile';
  const settingLabelKey = hasActiveWorkspace ? 'userPanel.workspaceSetting' : 'userPanel.setting';
  const activeNavKey = useActiveNavKey();
  const isHomeSidebar = activeNavKey === 'home';
  const billboardMenuItems = useBillboardMenuItems();
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  const trackMenuClick = useCallback(
    (key: string) => {
      try {
        analytics?.track({
          name: 'home_footer_menu_clicked',
          properties: { key, spm: `homepage.footer.${key}.clicked` },
        });
      } catch {
        // silently ignore tracking errors to avoid affecting business logic
      }
    },
    [analytics],
  );

  const handleOpenChangelogModal = useCallback(() => {
    openChangelogModal();
  }, []);

  const handleOpenFeedbackModal = useCallback(() => {
    openFeedbackModal();
  }, []);

  /**
   * Open an external link from a nested menu anchor. Base UI's menu item wraps
   * the anchor in a non-link menuitem and its own click/mouse-up handling can
   * drop the anchor's default navigation on the first press (rare but
   * observed). Opening synchronously from the anchor's own click event keeps
   * the link semantics (href, copy, middle-click) while making the navigation
   * deterministic from the user gesture.
   */
  const handleOpenExternal = useCallback((event: MouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault();
    window.open(href, '_blank', 'noopener,noreferrer');
  }, []);

  const { helpMenuItems, trackedMenuKeys } = useMemo<{
    helpMenuItems: MenuProps['items'];
    trackedMenuKeys: string[];
  }>(() => {
    const ownItems: FooterMenuItems = [
      ...(isPlatformAdmin && !hideDocs
        ? [
            {
              icon: <Icon icon={Info} />,
              key: 'about',
              label: (
                <WorkspaceLink escape to="/settings/about">
                  {tSetting('tab.about')}
                </WorkspaceLink>
              ),
            },
          ]
        : []),
      ...(footer.showSettingsEntry && !isDevMode
        ? [
            {
              icon: <Icon icon={Settings2} />,
              key: 'setting',
              label: <WorkspaceLink to={settingsHref}>{t(settingLabelKey)}</WorkspaceLink>,
            },
            {
              type: 'divider' as const,
            },
          ]
        : []),
      ...(enableBusinessFeatures
        ? [
            {
              icon: <Icon icon={Send} />,
              key: 'inviteFriend',
              label: (
                <WorkspaceLink to="/settings/referral">{t('userPanel.inviteFriend')}</WorkspaceLink>
              ),
            },
          ]
        : []),
      {
        icon: <Icon icon={Book} />,
        key: 'docs',
        label: (
          <a
            href={DOCUMENTS_REFER_URL}
            rel="noopener noreferrer"
            target="_blank"
            onClick={(event) => handleOpenExternal(event, DOCUMENTS_REFER_URL)}
          >
            {t('userPanel.docs')}
          </a>
        ),
      },
      {
        icon: <Icon icon={Feather} />,
        key: 'feedback',
        label: t('userPanel.feedback'),
        onClick: handleOpenFeedbackModal,
      },
      {
        icon: <Icon icon={DiscordIcon} />,
        key: 'discord',
        label: (
          <a
            href={SOCIAL_URL.discord}
            rel="noopener noreferrer"
            target="_blank"
            onClick={(event) => handleOpenExternal(event, SOCIAL_URL.discord)}
          >
            {t('userPanel.discord')}
          </a>
        ),
      },
      {
        type: 'divider',
      },
      {
        icon: <Icon icon={FileClockIcon} />,
        key: 'changelog',
        label: t('changelog'),
        onClick: handleOpenChangelogModal,
      },
      ...(footer.layout === 'compact'
        ? [
            {
              icon: <Icon icon={Download} />,
              key: 'get-app',
              label: (
                <WorkspaceLink escape to="/apps">
                  {t('getApp')}
                </WorkspaceLink>
              ),
            },
          ]
        : []),
      ...(footer.layout === 'compact' && !footer.hideGitHub
        ? [
            {
              icon: <Icon icon={GithubIcon} />,
              key: 'github',
              label: (
                <a
                  href={GITHUB}
                  rel="noopener noreferrer"
                  target="_blank"
                  onClick={(event) => handleOpenExternal(event, GITHUB)}
                >
                  GitHub
                </a>
              ),
            },
          ]
        : []),
      ...(footer.showEvalEntry && footer.layout === 'compact'
        ? [
            {
              icon: <Icon icon={FlaskConical} />,
              key: 'eval',
              label: <WorkspaceLink to="/eval">{translateTravel('评测实验室')}</WorkspaceLink>,
            },
          ]
        : []),
    ];

    return {
      helpMenuItems: [
        ...injectMenuTracking(ownItems, trackMenuClick),
        ...(isHomeSidebar && billboardMenuItems && billboardMenuItems.length > 0
          ? [{ type: 'divider' as const }, ...billboardMenuItems]
          : []),
      ],
      trackedMenuKeys: collectMenuKeys(ownItems),
    };
  }, [
    translateTravel,
    isPlatformAdmin,
    hideDocs,
    tSetting,
    trackMenuClick,
    footer.showSettingsEntry,
    footer.layout,
    footer.hideGitHub,
    footer.showEvalEntry,
    enableBusinessFeatures,
    handleOpenChangelogModal,
    handleOpenExternal,
    handleOpenFeedbackModal,
    isDevMode,
    t,
    settingLabelKey,
    settingsHref,
    billboardMenuItems,
    isHomeSidebar,
  ]);

  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return;
      try {
        analytics?.track({
          name: 'home_footer_menu_opened',
          properties: { keys: trackedMenuKeys.join(','), spm: 'homepage.footer.opened' },
        });
      } catch {
        // silently ignore tracking errors to avoid affecting business logic
      }
    },
    [analytics, trackedMenuKeys],
  );

  return (
    <>
      {isLogin &&
        !['settings', 'workspace-settings', 'memory', 'discover'].includes(activeNavKey ?? '') && (
          <Flexbox gap={4} paddingInline={12} style={{ paddingTop: 8 }}>
            {[
              { label: t('tab.generation'), icon: getRouteById('image')!.icon, to: '/image' },
              { label: t('tab.resource'), icon: getRouteById('resource')!.icon, to: '/resource' },
              { label: translateTravel('个人中心'), icon: UserRound, to: '/settings/profile' },
              {
                label: tAuth('tab.stats'),
                icon: ChartColumnBigIcon,
                to:
                  isPlatformAdmin === true
                    ? '/settings/stats'
                    : '/settings/credits?section=balance-usage',
              },
            ].map(({ label, icon, to }) => (
              <WorkspaceLink
                escape
                aria-label={label}
                data-nav-footer-link=""
                key={label}
                style={{ color: 'inherit', textDecoration: 'none' }}
                title={label}
                to={to}
              >
                <Flexbox horizontal align="center" gap={12} paddingBlock={8} paddingInline={4}>
                  <Icon icon={icon} size={20} />
                  <span data-nav-label="">{label}</span>
                </Flexbox>
              </WorkspaceLink>
            ))}
          </Flexbox>
        )}
      {footer.layout === 'expanded' ? (
        <Flexbox
          horizontal
          align={'center'}
          data-nav-footer-actions=""
          gap={2}
          justify={'space-between'}
          padding={8}
        >
          <Flexbox horizontal align={'center'} flex={1} gap={2}>
            <DropdownMenu
              items={helpMenuItems}
              placement="topLeft"
              onOpenChange={handleMenuOpenChange}
            >
              <ActionIcon
                aria-label={t('userPanel.help')}
                data-billboard-anchor=""
                icon={CircleHelp}
                size={16}
              />
            </DropdownMenu>
            {!footer.hideGitHub && (
              <a aria-label={'GitHub'} href={GITHUB} rel="noopener noreferrer" target={'_blank'}>
                <ActionIcon icon={GithubIcon} size={16} title={'GitHub'} />
              </a>
            )}
            <WorkspaceLink to="/eval">
              <ActionIcon icon={FlaskConical} size={16} title={translateTravel('评测实验室')} />
            </WorkspaceLink>
          </Flexbox>
          <ThemeButton placement={'topCenter'} size={16} />
        </Flexbox>
      ) : (
        <Flexbox horizontal align={'center'} data-nav-footer-actions="" gap={2} padding={8}>
          <DropdownMenu
            items={helpMenuItems}
            placement="topLeft"
            onOpenChange={handleMenuOpenChange}
          >
            <ActionIcon aria-label={t('userPanel.help')} icon={CircleHelp} size={16} />
          </DropdownMenu>
          {isDevMode && (
            <WorkspaceLink to={settingsHref}>
              <ActionIcon
                aria-label={t(settingLabelKey)}
                icon={SettingsIcon}
                size={16}
                title={t(settingLabelKey)}
              />
            </WorkspaceLink>
          )}
        </Flexbox>
      )}
      {isHomeSidebar && <Billboard />}
    </>
  );
});

export default Footer;
