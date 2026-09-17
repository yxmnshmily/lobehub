'use client';

import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ChevronLeft } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

import LeftPanel from './features/LeftPanel';
import SkillDetail, { type ToolDetailType } from './features/SkillDetail';
import { type SkillViewMode } from './features/SkillList';

export interface SelectedTool {
  identifier: string;
  type: ToolDetailType;
}

const styles = createStaticStyles(({ css }) => ({
  detail: css`
    overflow: hidden;

    /* 只让最内层（ConnectorDetail 的工具列表 / 文件内容）滚动——这里再滚一层
       就会出现双滚动条（外层带着返回按钮一起滚，内层工具列表又滚）。 */
    display: flex;
    flex: 1;
    flex-direction: column;

    min-width: 0;
    min-height: 0;
  `,
  mobileBack: css`
    display: flex;
    flex: none;
    align-items: center;

    min-height: 52px;
    padding-inline: 8px;
    border-block-end: 0.5px solid var(--ant-color-border-secondary);
  `,
  root: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    min-height: 0;

    /* Gutter comes from the shared settings container. */

    @media (width <= 575px) {
      padding: 0;
    }
  `,
}));

interface ToolSettingsProps {
  /**
   * The settings route knows its target shell before responsive hooks hydrate.
   * Prefer that explicit signal so mobile never flashes or keeps a desktop
   * master-detail header.
   */
  mobile?: boolean;
  /**
   * Which surface to manage. Fixed per-route now that skills and connectors
   * each own a dedicated settings page (`/settings/skill` and
   * `/settings/connector`) instead of sharing one tab-switched page.
   */
  viewMode: SkillViewMode;
}

export const ToolSettings = memo<ToolSettingsProps>(({ viewMode }) => {
  const { t } = useTranslation('common');
  const [searchParams] = useSearchParams();
  const querySkillIdentifier = searchParams.get('skill');
  const [selected, setSelected] = useState<SelectedTool | null>(null);

  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);

  useEffect(() => {
    if (viewMode !== 'skill' || !querySkillIdentifier) return;

    const skill = [...marketAgentSkills, ...userAgentSkills].find(
      (item) => item.identifier === querySkillIdentifier,
    );
    if (skill) setSelected({ identifier: skill.id, type: 'agent-skill' });
  }, [marketAgentSkills, querySkillIdentifier, userAgentSkills, viewMode]);

  const handleSelect = (identifier: string, type: ToolDetailType) => {
    setSelected({ identifier, type });
  };

  /* 统一的"下钻栈"布局（所有宽度一致）：列表占满整屏 → 点击进入整屏详情
     （顶部带返回）→ 返回回到列表。不再使用左右分栏——列表 | 详情、甚至
     列表 | 文件树 | 内容 的多层并排，在窄屏会被挤扁，在宽屏也要来回扫视。 */
  return (
    <div className={styles.root}>
      {!selected && (
        <LeftPanel
          mobile
          viewMode={viewMode}
          onDeleteSelected={() => setSelected(null)}
          onSelect={handleSelect}
        />
      )}

      {selected && (
        <div className={styles.detail}>
          <div className={styles.mobileBack}>
            <Button icon={ChevronLeft} style={{ minHeight: 44 }} onClick={() => setSelected(null)}>
              {t('back')}
            </Button>
          </div>
          <SkillDetail
            identifier={selected.identifier}
            type={selected.type}
            onDelete={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  );
});

ToolSettings.displayName = 'ToolSettings';

interface PageProps {
  mobile?: boolean;
}

export const ConnectorSettings = ({ mobile }: PageProps) => (
  <ToolSettings mobile={mobile} viewMode="connector" />
);

const Page = ({ mobile }: PageProps) => <ToolSettings mobile={mobile} viewMode="skill" />;

export default Page;
