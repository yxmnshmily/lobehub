import HomeSidebarContent from '@/features/HomeSidebar/Content';
import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

export default function AppsSidebar() {
  return (
    <NavPanelPortal navKey="apps">
      <HomeSidebarContent />
    </NavPanelPortal>
  );
}
