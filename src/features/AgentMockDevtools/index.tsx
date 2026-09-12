import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useMatches } from 'react-router';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import { Controls } from './Controls';

const styles = createStaticStyles(({ css }) => ({
  notice: css`
    display: block;
    flex-shrink: 0;
    padding: 12px;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
  `,
}));

const AgentMockPanel = memo(() => {
  const matches = useMatches();
  const isAgentTopicRoute = matches.some((m) => 'topicId' in m.params);

  return (
    <div className={devDockPanelStyles.root}>
      {!isAgentTopicRoute && (
        <Text className={styles.notice} fontSize={12} type={'secondary'}>
          请先打开一个智能体话题，再把模拟案例回放到对话中。
        </Text>
      )}
      <Controls />
    </div>
  );
});

AgentMockPanel.displayName = 'AgentMockPanel';

export default AgentMockPanel;
