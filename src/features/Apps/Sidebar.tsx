import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import SettingsSidebarContent from '@/features/Settings/Layout/SidebarContent';

export default function AppsSidebar() {
  return (
    <NavPanelPortal navKey="apps">
      <SettingsSidebarContent />
    </NavPanelPortal>
  );
}
