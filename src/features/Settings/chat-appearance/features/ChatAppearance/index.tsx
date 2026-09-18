'use client';

import { Flexbox, Form, FormGroup, highlighterThemes, mermaidThemes } from '@lobehub/ui';
import { Select, Switch, Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { SettingsSectionSkeleton } from '@/components/Skeleton';
import { FORM_STYLE } from '@/const/layoutTokens';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import ChatTransitionPreview from './ChatTransitionPreview';
import HighlighterPreview from './HighlighterPreview';
import LinkIconPreview from './LinkIconPreview';
import MermaidPreview from './MermaidPreview';

/* 2026-09-17：用户要求"代码高亮主题"分组去掉内填充和边距——
   覆盖 @lobehub/ui Collapse（FormGroup 桌面端实现）header/content 的 16px padding。 */
const flatGroupStyles = createStaticStyles(({ css }) => ({
  flat: css`
    > .ant-collapse-item > .ant-collapse-header {
      padding: 0 !important;
    }

    > .ant-collapse-item > .ant-collapse-content > .ant-collapse-content-box {
      padding: 0 !important;
    }

    /* 移动端分支：FormGroup 在 mobile 下不走 Collapse，渲染为普通 div 头/体——
       上面两条 ant 选择器 no-op，这里按直接子元素归零（审查发现的移动端缺口）。 */
    > div {
      padding: 0 !important;
    }
  `,
}));

const ChatAppearance = memo(() => {
  const { t } = useTranslation('setting');
  const { general } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();
  const [savingKey, setSavingKey] = useState<string>();

  if (!isUserStateInit) return <SettingsSectionSkeleton />;

  const handleChange = (key: string, value: any) => {
    setSavingKey(key);
    save(() => setSettings({ general: { [key]: value } }));
  };

  // Show the shared save-state hint only on the control the user last touched.
  const renderSaveHint = (key: string) =>
    savingKey === key && (
      <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />
    );

  return (
    <>
      <FormGroup
        collapsible={false}
        gap={16}
        title={t('settingChatAppearance.transitionMode.title')}
        variant={'borderless'}
        extra={
          <Flexbox horizontal align={'center'} gap={8}>
            {renderSaveHint('transitionMode')}
            <Tabs
              activeKey={general.transitionMode}
              items={[
                {
                  key: 'none',
                  label: t('settingChatAppearance.transitionMode.options.none.value'),
                },
                {
                  key: 'fadeIn',
                  label: t('settingChatAppearance.transitionMode.options.fadeIn'),
                },
                {
                  key: 'smooth',
                  label: t('settingChatAppearance.transitionMode.options.smooth'),
                },
              ]}
              onChange={(key) => handleChange('transitionMode', key)}
            />
          </Flexbox>
        }
      >
        <ChatTransitionPreview key={general.transitionMode} mode={general.transitionMode} />
      </FormGroup>

      <Form
        collapsible={false}
        itemsType={'group'}
        variant={'borderless'}
        items={[
          {
            children: [
              {
                children: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    {renderSaveHint('enableAutoScrollOnStreaming')}
                    <Switch
                      aria-label={t('settingChatAppearance.autoScrollOnStreaming.title')}
                      checked={general.enableAutoScrollOnStreaming ?? true}
                      title={t('settingChatAppearance.autoScrollOnStreaming.title')}
                      onChange={(checked) => handleChange('enableAutoScrollOnStreaming', checked)}
                    />
                  </Flexbox>
                ),
                label: t('settingChatAppearance.autoScrollOnStreaming.title'),
                minWidth: undefined,
              },
              {
                children: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    {renderSaveHint('expandWorkflowWhileStreaming')}
                    <Switch
                      aria-label={t('settingChatAppearance.workflowStreamingExpand.title')}
                      checked={general.expandWorkflowWhileStreaming ?? false}
                      title={t('settingChatAppearance.workflowStreamingExpand.title')}
                      onChange={(checked) => handleChange('expandWorkflowWhileStreaming', checked)}
                    />
                  </Flexbox>
                ),
                label: t('settingChatAppearance.workflowStreamingExpand.title'),
                minWidth: undefined,
              },
              {
                children: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    {renderSaveHint('enableMessageLinkIcon')}
                    <Switch
                      aria-label={t('settingChatAppearance.linkIcon.title')}
                      checked={general.enableMessageLinkIcon ?? true}
                      title={t('settingChatAppearance.linkIcon.title')}
                      onChange={(checked) => handleChange('enableMessageLinkIcon', checked)}
                    />
                  </Flexbox>
                ),
                desc: <LinkIconPreview />,
                label: t('settingChatAppearance.linkIcon.title'),
                minWidth: undefined,
              },
            ],
            title: t('settingChatAppearance.chatBehavior.title'),
          },
        ]}
        {...FORM_STYLE}
      />

      <FormGroup
        className={flatGroupStyles.flat}
        collapsible={false}
        gap={16}
        title={t('settingChatAppearance.highlighterTheme.title')}
        variant={'outlined'}
        extra={
          <Flexbox horizontal align={'center'} gap={8}>
            {renderSaveHint('highlighterTheme')}
            <Select
              value={general.highlighterTheme}
              options={highlighterThemes.map((item) => ({
                label: item.displayName,
                value: item.id,
              }))}
              style={{
                /* 2026-09-17：窄视口下收窄让位给左侧标题（"代码高亮主题"避免换行），
                   宽视口保持 240px 不变。 */
                width: 'min(240px, 40vw)',
              }}
              onChange={(value) => handleChange('highlighterTheme', value)}
            />
          </Flexbox>
        }
      >
        <HighlighterPreview key={general.highlighterTheme} theme={general.highlighterTheme} />
      </FormGroup>

      <FormGroup
        gap={16}
        title={t('settingChatAppearance.mermaidTheme.title')}
        variant={'borderless'}
        extra={
          <Flexbox horizontal align={'center'} gap={8}>
            {renderSaveHint('mermaidTheme')}
            <Select
              value={general.mermaidTheme}
              options={mermaidThemes.map((item) => ({
                label: item.displayName,
                value: item.id,
              }))}
              style={{
                width: 240,
              }}
              onChange={(value) => handleChange('mermaidTheme', value)}
            />
          </Flexbox>
        }
      >
        <MermaidPreview key={general.mermaidTheme} theme={general.mermaidTheme} />
      </FormGroup>
    </>
  );
});

export default ChatAppearance;
