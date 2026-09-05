import { and, eq } from 'drizzle-orm';

import { agents } from '../schemas/agent';
import { chatGroups, chatGroupsAgents } from '../schemas/chatGroup';
import { travelGenerationTasks } from '../schemas/travelGeneration';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export class TravelGenerationIdempotencyConflictError extends Error {
  readonly code = 'TRAVEL_GENERATION_IDEMPOTENCY_CONFLICT';

  constructor() {
    super('Travel generation idempotency key was reused with different request content');
    this.name = 'TravelGenerationIdempotencyConflictError';
  }
}

export class TravelGenerationTaskModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  async assertGroupOwnership(groupId: string): Promise<void> {
    const [group] = await this.db
      .select({ id: chatGroups.id })
      .from(chatGroups)
      .where(
        and(
          eq(chatGroups.id, groupId),
          eq(chatGroups.userId, this.userId),
          eq(chatGroups.visibility, 'private'),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, chatGroups),
        ),
      )
      .limit(1);
    if (!group) throw new Error('Travel generation group is not accessible');
  }

  async resolveGroupMemberAgentId(groupId: string, clientId: string): Promise<string | null> {
    await this.assertGroupOwnership(groupId);
    const [member] = await this.db
      .select({ agentId: agents.id })
      .from(chatGroupsAgents)
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, groupId),
          eq(chatGroupsAgents.enabled, true),
          eq(agents.userId, this.userId),
          eq(agents.clientId, clientId),
        ),
      )
      .orderBy(chatGroupsAgents.order, chatGroupsAgents.createdAt)
      .limit(1);
    return member?.agentId ?? null;
  }

  async create(value: {
    groupId: string;
    input: Record<string, unknown>;
    orderId?: string;
    status: string;
    type: string;
  }) {
    await this.assertGroupOwnership(value.groupId);
    const [record] = await this.db
      .insert(travelGenerationTasks)
      .values({ ...value, userId: this.userId, workspaceId: this.workspaceId })
      .returning();
    return record;
  }

  async createOrFindByIdempotency(value: {
    groupId: string;
    idempotencyKey: string;
    input: Record<string, unknown>;
    orderId?: string;
    requestHash: string;
    status: string;
    type: string;
  }) {
    await this.assertGroupOwnership(value.groupId);
    const [created] = await this.db
      .insert(travelGenerationTasks)
      .values({ ...value, userId: this.userId, workspaceId: this.workspaceId })
      .onConflictDoNothing()
      .returning();

    if (created) return { created: true, record: created } as const;

    const existing = await this.db.query.travelGenerationTasks.findFirst({
      where: and(
        eq(travelGenerationTasks.userId, this.userId),
        eq(travelGenerationTasks.groupId, value.groupId),
        eq(travelGenerationTasks.type, value.type),
        eq(travelGenerationTasks.idempotencyKey, value.idempotencyKey),
        buildWorkspaceWhere(
          { userId: this.userId, workspaceId: this.workspaceId },
          travelGenerationTasks,
        ),
      ),
    });

    if (!existing) {
      throw new Error('Travel generation idempotency conflict did not resolve to a task');
    }
    if (existing.requestHash !== value.requestHash) {
      throw new TravelGenerationIdempotencyConflictError();
    }

    return { created: false, record: existing } as const;
  }

  async findById(id: string) {
    return this.db.query.travelGenerationTasks.findFirst({
      where: and(
        eq(travelGenerationTasks.id, id),
        eq(travelGenerationTasks.userId, this.userId),
        buildWorkspaceWhere(
          { userId: this.userId, workspaceId: this.workspaceId },
          travelGenerationTasks,
        ),
      ),
    });
  }

  async update(id: string, patch: Record<string, unknown>) {
    return this.db
      .update(travelGenerationTasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(travelGenerationTasks.id, id),
          eq(travelGenerationTasks.userId, this.userId),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            travelGenerationTasks,
          ),
        ),
      );
  }
}
