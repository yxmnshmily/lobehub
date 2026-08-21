import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useMatches } from 'react-router';

import { Controls } from './Controls';

const AgentMockPanel = memo(() => {
  const matches = useMatches();
  const isAgentTopicRoute = matches.some((m) => 'topicId' in m.params);

  return (
    <Flexbox gap={12} padding={16} style={{ marginInline: 'auto', maxWidth: 560, width: '100%' }}>
      {!isAgentTopicRoute && (
        <Text fontSize={12} type={'secondary'}>
          请先打开一个智能体话题，再把模拟案例回放到对话中。
        </Text>
      )}
      <Controls />
    </Flexbox>
  );
});

AgentMockPanel.displayName = 'AgentMockPanel';

export default AgentMockPanel;
