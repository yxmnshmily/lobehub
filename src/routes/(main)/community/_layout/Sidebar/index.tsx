'use client';

import SidebarContent from '@/features/Settings/Layout/SidebarContent';
import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

/**
 * The community route shows exactly the same navigation pane as the settings
 * pages, so it mounts the settings sidebar body itself rather than a parallel
 * copy — one component, one set of styles.
 *
 * The navKey stays route-owned ("discover"): two routes registering the same
 * key race on unregister, which leaves the pane empty when switching between
 * them.
 */
const Sidebar = () => (
  <NavPanelPortal navKey="discover">
    <SidebarContent />
  </NavPanelPortal>
);

export default Sidebar;
