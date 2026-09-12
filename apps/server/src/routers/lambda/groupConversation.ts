import type { ChatFileItem, ChatImageItem, UIChatMessage } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  type AccessibleConversationTopic,
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
  // The repository matches the canonical default-group clientId for every returned row.
  isDefaultGroup: true,
  joinedAt: item.joinedAt,
  kind: item.kind,
  membershipVersion: item.membershipVersion,
  ownerDisplayName: item.ownerDisplayName,
  title: item.title,
});

const safeTopic = (item: AccessibleConversationTopic) => ({
  ...(item.favorite !== undefined ? { favorite: item.favorite } : {}),
  ...(item.updatedAt
    ? { updatedAt: item.updatedAt, status: item.status, trigger: item.trigger }
    : {}),
  ...(item.latestMessage
    ? { latestMessage: item.latestMessage, latestMessageId: item.latestMessageId }
    : {}),
  createdAt: item.createdAt,
  id: item.id,
  title: item.title,
});

const safeAttachments = (item: { fileList?: ChatFileItem[]; imageList?: ChatImageItem[] }) => ({
  ...(item.fileList
    ? {
        fileList: item.fileList.map(({ id, name, size, fileType, url, downloadUrl }) => ({
          id,
          name,
          size,
          fileType,
          url,
          downloadUrl,
        })),
      }
    : {}),
  ...(item.imageList
    ? { imageList: item.imageList.map(({ id, alt, url }) => ({ id, alt, url })) }
    : {}),
});

const safeMessage = (item: {
  authorKind: 'member' | 'owner' | 'self';
  content: string;
  fileList?: ChatFileItem[];
  imageList?: ChatImageItem[];
  publicMessageId: string;
  sender?: { avatar: string | null; fullName: string | null; id: string };
  topicId: string;
  visibleAt: Date;
}) => ({
  authorKind: item.authorKind,
  content: item.content,
  ...safeAttachments(item),
  publicMessageId: item.publicMessageId,
  ...(item.sender
    ? {
        sender: {
          avatar: item.sender.avatar,
          fullName: item.sender.fullName,
          id: item.sender.id,
        },
      }
    : {}),
  topicId: item.topicId,
  visibleAt: item.visibleAt,
});

const safePublishedAssistantMessage = (item: {
  agentId?: string | null;
  content: string;
  executionMessages?: UIChatMessage[];
  fileList?: ChatFileItem[];
  imageList?: ChatImageItem[];
  id: string;
  isGenerating?: boolean;
  kind: 'assistant';
  topicId: string;
  visibleAt: Date;
}) => ({
  ...(item.agentId ? { agentId: item.agentId } : {}),
  ...safeAttachments(item),
  content: item.content,
  ...(item.executionMessages ? { executionMessages: item.executionMessages } : {}),
  id: item.id,
  ...(item.isGenerating ? { isGenerating: true } : {}),
  kind: item.kind,
  topicId: item.topicId,
  visibleAt: item.visibleAt,
});

export const groupConversationRouter = router({
  updateTextMessage: personalGroupConversationProcedure
    .input(
      z
        .object({
          groupId: id,
          publicMessageId: z.string().regex(/^[a-f\d]{64}$/),
          visibleAt: z.date(),
          content: nonBlank(8000).nullable(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      safely(() =>
        new ConversationRepository(ctx.serverDB).updateAccessibleTextMessage(ctx.userId, input),
      ),
    ),
  listTasks: personalGroupConversationProcedure
    .input(
      z
        .object({
          groupId: id,
          offset: z.number().int().min(0).default(0),
          category: z
            .enum(['all', 'running', 'success', 'failed', 'error', 'usage'])
            .default('all'),
        })
        .strict(),
    )
    .query(({ ctx, input }) =>
      safely(() =>
        new ConversationRepository(ctx.serverDB).listAccessibleTasks(
          ctx.userId,
          input.groupId,
          input.offset,
          input.category,
        ),
      ),
    ),
  createTextMessage: personalGroupConversationProcedure
    .input(
      z
        .object({
          content: nonBlank(8000),
          fileIds: z.array(id).max(20).optional(),
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
    .input(
      z
        .object({
          groupId: id,
          topicId: id.optional(),
          includeInProgress: z.boolean().optional(),
          recent: z.boolean().optional(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const items = await safely(() =>
        new ConversationRepository(ctx.serverDB).listAccessiblePublishedAssistantMessages(
          ctx.userId,
          input.groupId,
          input.topicId,
          undefined,
          input.includeInProgress,
          input.recent,
        ),
      );
      return items.map(safePublishedAssistantMessage);
    }),

  listTextMessages: personalGroupConversationProcedure
    .input(
      z
        .object({
          cursor: messageCursor.optional(),
          direction: z.enum(['latest', 'oldest', 'forward', 'backward']).optional(),
          order: z.enum(['latest', 'oldest']).optional(),
          groupId: id,
          limit: page.limit,
          topicId: id.optional(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const result = await safely(() =>
        new ConversationRepository(ctx.serverDB).listAccessibleTextMessages(
          ctx.userId,
          input.groupId,
          input.topicId,
          {
            cursor: input.cursor,
            direction: input.order ?? (input.direction === 'latest' ? 'latest' : 'oldest'),
            limit: input.limit,
          },
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
          recent: z.boolean().optional(),
          keywords: z.string().trim().max(200).optional(),
          order: z.enum(['latest', 'oldest']).optional(),
          direction: z.enum(['forward', 'backward']).optional(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const result = await safely(() =>
        new ConversationRepository(ctx.serverDB).listAccessibleTopics(ctx.userId, input.groupId, {
          cursor: input.cursor,
          limit: input.limit,
          recent: input.recent,
          keywords: input.keywords,
          direction: input.order,
        }),
      );
      return { items: result.items.map(safeTopic), nextCursor: result.nextCursor };
    }),
});
