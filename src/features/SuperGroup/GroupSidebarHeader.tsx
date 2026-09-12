'use client';

import type { FC } from 'react';

// Group navigation lives in GroupSwitcher; omit the duplicate home/count row
// for both owned and joined groups, including its dedicated topic polling.
const GroupSidebarHeader: FC<{
  groupId: string;
  managed?: boolean;
  onHome: () => void;
}> = () => null;

export default GroupSidebarHeader;
