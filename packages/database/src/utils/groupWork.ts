import { type SQL, sql } from 'drizzle-orm';

import { chatGroups } from '../schemas/chatGroup';
import { buildWorkspaceWhere } from './workspace';

/** Additional visibility for group-owned work; legacy personal work stays unchanged. */
export const groupWorkVisibility = (config: SQL, userId: string, workspaceId?: string) => sql`(
  ${config}->>'groupId' IS NULL OR EXISTS (
    SELECT 1 FROM ${chatGroups}
    WHERE ${chatGroups.id} = ${config}->>'groupId'
      AND ${buildWorkspaceWhere({ userId, workspaceId }, chatGroups)}
  )
)`;
