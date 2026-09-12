import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import HomeSidebarContent from './Content';
import TaskSidebarContent from './TaskSidebarContent';

const HomeNavPanelPortal = () => (
  <>
    <NavPanelPortal navKey="home">
      <HomeSidebarContent />
    </NavPanelPortal>
    <NavPanelPortal navKey="data-center">
      <TaskSidebarContent />
    </NavPanelPortal>
    <NavPanelPortal navKey="tasks">
      <TaskSidebarContent />
    </NavPanelPortal>
  </>
);

export default HomeNavPanelPortal;
