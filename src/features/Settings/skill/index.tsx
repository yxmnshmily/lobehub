'use client';

import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ChevronLeft } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors, builtinToolSelectors } from '@/store/tool/selectors';

import LeftPanel from './features/LeftPanel';
import SkillDetail, { type ToolDetailType } from './features/SkillDetail';
import { type SkillViewMode } from './features/SkillList';
import { shouldUseMobileToolLayout } from './mobileLayout';

export interface SelectedTool {
  identifier: string;
  type: ToolDetailType;
}

const styles = createStaticStyles(({ css }) => ({
  detail: css`
    overflow-y: auto;
    flex: 1;
    min-width: 0;
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

    @media (max-width: 575px) {
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

export const ToolSettings = memo<ToolSettingsProps>(({ mobile: routeMobile, viewMode }) => {
  const { t } = useTranslation('common');
  const { t: tSetting } = useTranslation('setting');
  const { mobile: responsiveMobile = false } = useResponsive();
  const runtimeMobile = useServerConfigStore(serverConfigSelectors.isMobile);
  const mobileViewport =
    routeMobile === undefined &&
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 575px)').matches;
  const mobile =
    routeMobile ?? shouldUseMobileToolLayout(responsiveMobile, runtimeMobile, mobileViewport);
  const [searchParams] = useSearchParams();
  const querySkillIdentifier = searchParams.get('skill');
  const [selected, setSelected] = useState<SelectedTool | null>(null);

  const builtinTools = useToolStore((s) => s.builtinTools, isEqual);
  const builtinSkills = useToolStore((s) => s.builtinSkills, isEqual);
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);
  const installedBuiltinIds = useToolStore(
    (s) => builtinToolSelectors.installedAllMetaList(s).map((tool) => tool.identifier),
    isEqual,
  );

  useEffect(() => {
    if (selected) return;
    if (mobile) return;
    if (viewMode === 'skill' && querySkillIdentifier) return;
    if (viewMode === 'connector') {
      const firstTool = builtinTools.find(
        (tool) => !tool.hidden && installedBuiltinIds.includes(tool.identifier),
      );
      if (firstTool) {
        setSelected({ identifier: firstTool.identifier, type: 'builtin' });
      }
    } else {
      const firstSkill = builtinSkills[0];
      if (firstSkill) {
        setSelected({ identifier: firstSkill.identifier, type: 'builtin-skill' });
      }
    }
  }, [
    builtinTools,
    builtinSkills,
    installedBuiltinIds,
    mobile,
    querySkillIdentifier,
    selected,
    viewMode,
  ]);

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

  return (
    <>
      <div className={styles.root}>
        {(!mobile || !selected) && (
          <LeftPanel
            mobile={mobile}
            selectedIdentifier={selected?.identifier}
            viewMode={viewMode}
            onDeleteSelected={() => setSelected(null)}
            onSelect={handleSelect}
          />
        )}

        {selected && (
          <div className={styles.detail}>
            {mobile && (
              <div className={styles.mobileBack}>
                <Button
                  icon={ChevronLeft}
                  style={{ minHeight: 44 }}
                  onClick={() => setSelected(null)}
                >
                  {t('back')}
                </Button>
              </div>
            )}
            <SkillDetail
              identifier={selected.identifier}
              type={selected.type}
              onDelete={() => setSelected(null)}
            />
          </div>
        )}
      </div>
    </>
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
