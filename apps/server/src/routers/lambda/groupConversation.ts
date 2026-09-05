import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  GROUP_CONVERSATION_IDEMPOTENCY_CONFLICT,
  GROUP_CONVERSATION_INVALID_INPUT,
  GroupConversationAccessRepository as ConversationRepository,
  GroupConversationIdempotencyConflictError,
  GroupConversationInvalidInputError,
} from '@/server/services/groupConversationAccess/conversationRepository';
import {
  GROUP_CONVERSATION_ACCESS_UNAVAILABLE,
  GroupConversationAccessUnavailableError,
} from '@/server/services/groupConversationAccess/principal';
import { GroupConversationAccessRepository as GroupRepository } from '@/server/services/groupConversationAccess/repository';

const GROUP_CONVERSATION_OPERATION_FAILED = 'GROUP_CONVERSATION_OPERATION_FAILED';

const id = z.string().trim().min(1).max(255);
const nonBlank = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0);
const idempotencyKey = nonBlank(128).regex(/^[\x20-\x7E]+$/);
const cursor = z
  .object({
    createdAt: z.date(),
    id,
  })
  .strict();
const messageCursor = z
  .object({
    createdAt: z.date(),
    id: z.string().regex(/^[a-f\d]{64}$/),
  })
  .strict();
const page = {
  cursor: cursor.optional(),
  limit: z.number().int().min(1).max(50).optional(),
};

const personalGroupConversationProcedure = authedProcedure
  .use(serverDatabase)
  .use(async ({ ctx, next }) => {
    if (ctx.workspaceId) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: GROUP_CONVERSATION_ACCESS_UNAVAILABLE,
      });
    }

    return next({ ctx });
  });

const safely = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof GroupConversationAccessUnavailableError) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: GROUP_CONVERSATION_ACCESS_UNAVAILABLE,
      });
    }
    if (error instanceof GroupConversationInvalidInputError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: GROUP_CONVERSATION_INVALID_INPUT });
    }
    if (error instanceof GroupConversationIdempotencyConflictError) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: GROUP_CONVERSATION_IDEMPOTENCY_CONFLICT,
      });
    }

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: GROUP_CONVERSATION_OPERATION_FAILED,
    });
  }
};

const safeGroup = (item: Awaited<ReturnType<GroupRepository['getAccessibleGroupSummary']>>) => ({
  avatar: item.avatar,
  groupId: item.groupId,
  joinedAt: item.joinedAt,
  kind: item.kind,
  membershipVersion: item.membershipVersion,
  title: item.title,
});

const safeTopic = (item: { createdAt: Date; id: string; title: string | null }) => ({
  createdAt: item.createdAt,
  id: item.id,
  title: item.title,
});

const safeMessage = (item: {
  authorKind: 'member' | 'owner' | 'self';
  content: string;
  publicMessageId: string;
  topicId: string;
  visibleAt: Date;
}) => ({
  authorKind: item.authorKind,
  content: item.content,
  publicMessageId: item.publicMessageId,
  topicId: item.topicId,
  visibleAt: item.visibleAt,
});

const safePublishedAssistantMessage = (item: {
  content: string;
  id: string;
  kind: 'assistant';
  topicId: string;
  visibleAt: Date;
}) => ({
  content: item.content,
  id: item.id,
  kind: item.kind,
  topicId: item.topicId,
  visibleAt: item.visibleAt,
});

export const groupConversationRouter = router({
  createTextMessage: personalGroupConversationProcedure
    .input(
      z
        .object({
          content: nonBlank(8000),
          groupId: id,
          idempotencyKey,
          topicId: id,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await safely(() =>
        new ConversationRepository(ctx.serverDB).createAccessibleTextMessage(ctx.userId, input),
      );
      return safeMessage(item);
    }),

  createTopic: personalGroupConversationProcedure
    .input(
      z
        .object({
          groupId: id,
          idempotencyKey,
          title: nonBlank(200),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await safely(() =>
        new ConversationRepository(ctx.serverDB).createAccessibleTopic(ctx.userId, input),
      );
      return safeTopic(item);
    }),

  listGroups: personalGroupConversationProcedure.input(z.undefined()).query(async ({ ctx }) => {
    const items = await safely(() =>
      new GroupRepository(ctx.serverDB).listAccessibleGroupSummaries(ctx.userId),
    );
    return items.map(safeGroup);
  }),

  listPublishedAssistantMessages: personalGroupConversationProcedure
    .input(z.object({ groupId: id, topicId: id }).strict())
    .query(async ({ ctx, input }) => {
      const items = await safely(() =>
        new ConversationRepository(ctx.serverDB).listAccessiblePublishedAssistantMessages(
          ctx.userId,
          input.groupId,
          input.topicId,
        ),
      );
      return items.map(safePublishedAssistantMessage);
    }),

  listTextMessages: personalGroupConversationProcedure
    .input(
      z
        .object({
          cursor: messageCursor.optional(),
          groupId: id,
          limit: page.limit,
          topicId: id,
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const result = await safely(() =>
        new ConversationRepository(ctx.serverDB).listAccessibleTextMessages(
          ctx.userId,
          input.groupId,
          input.topicId,
          { cursor: input.cursor, limit: input.limit },
        ),
      );
      return { items: result.items.map(safeMessage), nextCursor: result.nextCursor };
    }),

  listTopics: personalGroupConversationProcedure
    .input(
      z
        .object({
          ...page,
          groupId: id,
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const result = await safely(() =>
        new ConversationRepository(ctx.serverDB).listAccessibleTopics(ctx.userId, input.groupId, {
          cursor: input.cursor,
          limit: input.limit,
        }),
      );
      return { items: result.items.map(safeTopic), nextCursor: result.nextCursor };
    }),
});
