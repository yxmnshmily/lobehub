import { Accordion, Flexbox } from '@lobehub/ui';

import HumanMembers from './HumanMembers';
import Members from './Members';
import Topic from './Topic';

export enum ChatSidebarKey {
  HumanMembers = 'human-members',
  Members = 'members',
  Topic = 'topic',
}

const Body = () => {
  return (
    <Flexbox paddingInline={4}>
      <Accordion
        gap={8}
        defaultExpandedKeys={[
          ChatSidebarKey.Members,
          ChatSidebarKey.HumanMembers,
          ChatSidebarKey.Topic,
        ]}
      >
        <Members itemKey={ChatSidebarKey.Members} />
        <HumanMembers itemKey={ChatSidebarKey.HumanMembers} />
        <Topic itemKey={ChatSidebarKey.Topic} />
      </Accordion>
    </Flexbox>
  );
};

export default Body;
