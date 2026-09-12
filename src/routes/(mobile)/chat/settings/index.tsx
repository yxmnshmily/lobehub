'use client';

import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useState } from 'react';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import { useCategory } from '@/features/AgentSetting/AgentCategory/useCategory';
import AgentSettings from '@/features/AgentSetting/AgentSettings';
import Footer from '@/features/Setting/Footer';
import { usePermission } from '@/hooks/usePermission';
import MobileHeader from '@/routes/(mobile)/chat/settings/_layout/Header';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';
import { useSessionStore } from '@/store/session';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding-block: 16px;
    padding-inline: 0;
  `,
  tabs: css`
    width: 100%;
    min-width: 0;
    max-width: 100%;

    [role='tablist'] {
      scrollbar-width: none;
      overflow-x: auto;
      overscroll-behavior-inline: contain;
      touch-action: pan-x;
      -webkit-overflow-scrolling: touch;
    }

    [role='tablist']::-webkit-scrollbar {
      display: none;
    }

    [role='tab'] {
      flex: none;
      min-height: 44px;
      white-space: nowrap;
    }
  `,
}));

export default memo(() => {
  const [tab, setTab] = useState(ChatSettingsTabs.Prompt);
  const cateItems = useCategory();
  const id = useSessionStore((s) => s.activeId);
  const { allowed: canEdit } = usePermission('edit_own_content');

  const [updateAgentConfig, updateAgentMeta, config, meta] = useAgentStore((s) => [
    s.updateAgentConfig,
    s.updateAgentMeta,
    agentSelectors.currentAgentConfig(s),
    agentSelectors.currentAgentMeta(s),
  ]);

  const isLoading = false;

  return (
    <MobileContentLayout header={<MobileHeader />}>
      <Tabs
        activeKey={tab}
        className={styles.tabs}
        items={cateItems as any}
        style={{
          borderBottom: `0.5px solid ${cssVar.colorBorderSecondary}`,
        }}
        onChange={(value) => setTab(value as ChatSettingsTabs)}
      />
      <div className={styles.body}>
        <AgentSettings
          config={config}
          disabled={!canEdit}
          id={id}
          loading={isLoading}
          meta={meta}
          tab={tab}
          onConfigChange={updateAgentConfig}
          onMetaChange={updateAgentMeta}
        />
        <Footer />
      </div>
    </MobileContentLayout>
  );
});
