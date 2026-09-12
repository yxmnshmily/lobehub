import { create } from 'zustand';

import type { GroupWorkKind } from './groupWorkEntries';

/** One transient navigation request; no work or private conversation data is persisted here. */
export const useGroupWorkRequest = create<{
  request: {
    detail?: { agentId?: string; id: string; title?: string };
    groupId: string;
    kind: GroupWorkKind;
    trigger?: HTMLElement;
  } | null;
}>(() => ({ request: null }));
