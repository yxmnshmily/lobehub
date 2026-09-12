'use client';

import { isDesktop } from '@lobechat/const';
import type { FormGroupItemType } from '@lobehub/ui';
import { Flexbox, Form } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '@/components/Skeleton/Bar';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { preferenceSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';

import { APPLICATION_DEFAULT_FONT, useSystemFontOptions } from '../useSystemFontOptions';
import { FontSizeControl } from './FontSize';

const wrapperCol = {
  style: {
    maxWidth: '100%',
    width: '100%',
  },
};

const loadingTextStyle = { marginBlock: 1.5 };

const FontSettings = memo(() => {
  const { t } = useTranslation('setting');
  const [fontFamily, monospaceFontFamily] = useUserStore((s) => [
    preferenceSelectors.fontFamily(s),
    preferenceSelectors.terminalFontFamily(s),
  ]);
  const fontSize = useUserStore(userGeneralSettingsSelectors.fontSize);
  const updatePreference = useUserStore((s) => s.updatePreference);
  const setSettings = useUserStore((s) => s.setSettings);
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();

  const interfaceFonts = useSystemFontOptions({
    defaultLabel: t('settingAppearance.font.fontFamily.default'),
    enabled: isDesktop,
    unavailableLabel: (font) => t('settingAppearance.font.fontFamily.unavailable', { font }),
    value: fontFamily,
  });
  const monospaceFonts = useSystemFontOptions({
    defaultLabel: t('settingAppearance.font.monospace.default'),
    enabled: isDesktop,
    monospaceOnly: true,
    unavailableLabel: (font) => t('settingAppearance.font.monospace.unavailable', { font }),
    value: monospaceFontFamily,
  });

  if (!isUserStateInit) {
    const loadingFont: FormGroupItemType = {
      children: [
        ...(isDesktop
          ? [
              {
                children: <SkeletonBar height={32} width={320} />,
                desc: <SkeletonBar height={12} style={loadingTextStyle} width={240} />,
                label: <SkeletonBar height={16} style={loadingTextStyle} width={96} />,
                minWidth: undefined,
              },
              {
                children: <SkeletonBar height={32} width={320} />,
                desc: <SkeletonBar height={12} style={loadingTextStyle} width={280} />,
                label: <SkeletonBar height={16} style={loadingTextStyle} width={128} />,
                minWidth: undefined,
              },
            ]
          : []),
        {
          children: (
            <Flexbox gap={16} width={'100%'}>
              <Flexbox gap={24}>
                <SkeletonBar height={4} width={'100%'} />
                <Flexbox horizontal align={'center'} justify={'space-between'}>
                  <SkeletonBar height={14} width={12} />
                  <SkeletonBar height={14} width={64} />
                  <SkeletonBar height={14} width={12} />
                </Flexbox>
              </Flexbox>
              <Flexbox justify={'center'} style={{ height: 30 }}>
                <SkeletonBar height={16} style={{ maxWidth: '100%' }} width={400} />
              </Flexbox>
            </Flexbox>
          ),
          desc: <SkeletonBar height={12} style={loadingTextStyle} width={144} />,
          label: <SkeletonBar height={16} style={loadingTextStyle} width={72} />,
          layout: 'vertical',
          minWidth: '100%',
          wrapperCol,
        },
      ],
      extra: <SkeletonBar height={16} width={136} />,
      title: <SkeletonBar height={18} width={48} />,
    };

    return (
      <Form
        aria-busy
        collapsible={false}
        items={[loadingFont]}
        itemsType={'group'}
        variant={'filled'}
        {...FORM_STYLE}
      />
    );
  }

  const font: FormGroupItemType = {
    children: [
      ...(isDesktop
        ? [
            {
              children: (
                <Select
                  showSearch
                  aria-label={t('settingAppearance.font.fontFamily.title')}
                  loading={interfaceFonts.isLoading}
                  options={interfaceFonts.options}
                  style={{ width: 320 }}
                  value={fontFamily || APPLICATION_DEFAULT_FONT}
                  onChange={(value: string) =>
                    save(() =>
                      updatePreference({
                        fontFamily: value === APPLICATION_DEFAULT_FONT ? '' : value,
                      }),
                    )
                  }
                />
              ),
              desc: interfaceFonts.hasLoadError
                ? t('settingAppearance.font.fontFamily.loadError')
                : t('settingAppearance.font.fontFamily.desc'),
              label: (
                <SettingsSearchAnchor id={'appearance-font-family'}>
                  {t('settingAppearance.font.fontFamily.title')}
                </SettingsSearchAnchor>
              ),
              minWidth: undefined,
            },
            {
              children: (
                <Select
                  showSearch
                  aria-label={t('settingAppearance.font.monospace.title')}
                  loading={monospaceFonts.isLoading}
                  options={monospaceFonts.options}
                  style={{ width: 320 }}
                  value={monospaceFontFamily || APPLICATION_DEFAULT_FONT}
                  onChange={(value: string) =>
                    save(() =>
                      updatePreference({
                        terminalFontFamily: value === APPLICATION_DEFAULT_FONT ? '' : value,
                      }),
                    )
                  }
                />
              ),
              desc: monospaceFonts.hasLoadError
                ? t('settingAppearance.font.monospace.loadError')
                : t('settingAppearance.font.monospace.desc'),
              label: (
                <SettingsSearchAnchor id={'appearance-monospace-font'}>
                  {t('settingAppearance.font.monospace.title')}
                </SettingsSearchAnchor>
              ),
              minWidth: undefined,
            },
          ]
        : []),
      {
        children: (
          <FontSizeControl
            value={fontSize}
            onChange={(value) => save(() => setSettings({ general: { fontSize: value } }))}
          />
        ),
        desc: t('settingChatAppearance.fontSize.desc'),
        label: (
          <SettingsSearchAnchor id={'appearance-font-size'}>
            {t('settingChatAppearance.fontSize.title')}
          </SettingsSearchAnchor>
        ),
        layout: 'vertical',
        minWidth: '100%',
        wrapperCol,
      },
    ],
    extra: <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />,
    title: t('settingAppearance.font.title'),
  };

  return (
    <Form
      collapsible={false}
      items={[font]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default FontSettings;
