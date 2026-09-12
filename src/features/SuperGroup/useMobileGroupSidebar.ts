import { createContext, use } from 'react';

export const MobileSidebarContext = createContext<{ open: boolean; toggle: () => void } | null>(
  null,
);

export const useMobileGroupSidebar = () => use(MobileSidebarContext);
