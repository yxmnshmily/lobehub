'use client';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import SidebarContent from './SidebarContent';

const Sidebar = () => (
  <NavPanelPortal navKey="pages">
    <SidebarContent />
  </NavPanelPortal>
);

export default Sidebar;
