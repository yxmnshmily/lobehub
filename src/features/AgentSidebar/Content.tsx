import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Header from './Header';

const AgentSidebarContent = () => {
  // Temporarily hide the agent topic history; keep its component and data intact.
  return <SideBarLayout header={<Header />} />;
};

export default AgentSidebarContent;
