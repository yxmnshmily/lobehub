import { createHmac } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { TravelGenerationTaskModel } from '@/database/models/travelGeneration';
import { UserModel } from '@/database/models/user';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { getActiveSession } from '@/libs/better-auth/getActiveSession';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';
import {
  getWebsiteAiCapabilities,
  WEBSITE_AI_BALANCE_CHECK_UNAVAILABLE,
  WEBSITE_AI_BALANCE_INSUFFICIENT,
  WEBSITE_AI_CONTENT_BLOCKED,
  WEBSITE_AI_GENERATION_LIMIT_REQUIRED,
  WEBSITE_AI_GROUP_NOT_PRIVATE,
  WEBSITE_AI_IMAGE_MODEL_UNAVAILABLE,
  WEBSITE_AI_IMAGE_USAGE_UNAVAILABLE,
  WEBSITE_AI_PRODUCTION_CAPABILITY_UNAVAILABLE,
  WEBSITE_AI_SERVICE_BILLING_UNAVAILABLE,
  WEBSITE_AI_SUPERVISOR_FALLBACK_DENIED,
  WEBSITE_AI_SUPERVISOR_INVALID,
  WEBSITE_AI_VIDEO_USAGE_UNAVAILABLE,
  type WebsiteAiService,
} from '@/server/services/websiteAi';
import { websiteAiInFlightLimiter } from '@/server/services/websiteAi/inFlight';
import {
  type WebsiteAiPreviousTurnHandle,
  websiteAiPreviousTurnStore,
} from '@/server/services/websiteAi/previousTurn';
import { WEBSITE_AI_SETTLEMENT_GATED_TEXT } from '@/server/services/websiteAi/supervisorFallback';
import {
  createWebsiteAiProgressTracker,
  normalizeWebsiteAiArtifactUrl,
  normalizeWebsiteAiStreamEvent,
} from '@/server/services/websiteAi/types';

const requestSchema = z
  .object({
    maxCredits: z.number().int().positive().safe().optional(),
    prompt: z.string().trim().min(1).max(2000),
    topicId: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(1).max(128).optional(),
    ),
  })
  .strict();
const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x20-\x7E]+$/);
const runtimeStreamCursorSchema = z
  .string()
  .regex(/^\d+-\d+$/)
  .max(64);
const publicFrameCursorSchema = z
  .string()
  .regex(/^\d+-\d+\.\d{1,4}$/)
  .max(69)
  .refine(
    (value) => runtimeStreamCursorSchema.safeParse(value.slice(0, value.lastIndexOf('.'))).success,
  );
const streamCursorSchema = z.union([
  z.literal('0'),
  runtimeStreamCursorSchema,
  publicFrameCursorSchema,
]);
const generationStatusSchema = z.object({ taskId: z.string().trim().min(1).max(255) }).strict();
const WEBSITE_AI_HEARTBEAT_INTERVAL_MS = 15_000;
const WEBSITE_AI_IDLE_TIMEOUT_MS = 120_000;
const WEBSITE_AI_MAX_BUFFERED_SSE_BYTES = 256 * 1024;
const WEBSITE_AI_MAX_SSE_EVENT_BYTES = 64 * 1024;
const WEBSITE_AI_MAX_SSE_EVENTS = 8192;
const WEBSITE_AI_MAX_SSE_TOTAL_BYTES = 8 * 1024 * 1024;
const WEBSITE_AI_SSE_TERMINAL_RESERVE_BYTES = 1024;
const ACCOUNT_UNAVAILABLE = {
  code: 'ACCOUNT_UNAVAILABLE',
  message: '当前账号暂不可使用官网 AI，请重新登录后再试。',
} as const;
const GENERATION_NOT_FOUND = {
  code: 'NOT_FOUND',
  message: '未找到对应的生成任务。',
} as const;
const publicServiceErrors = [
  WEBSITE_AI_BALANCE_CHECK_UNAVAILABLE,
  WEBSITE_AI_BALANCE_INSUFFICIENT,
  WEBSITE_AI_CONTENT_BLOCKED,
  WEBSITE_AI_GROUP_NOT_PRIVATE,
  WEBSITE_AI_GENERATION_LIMIT_REQUIRED,
  WEBSITE_AI_IMAGE_USAGE_UNAVAILABLE,
  WEBSITE_AI_IMAGE_MODEL_UNAVAILABLE,
  WEBSITE_AI_PRODUCTION_CAPABILITY_UNAVAILABLE,
  WEBSITE_AI_SERVICE_BILLING_UNAVAILABLE,
  WEBSITE_AI_SUPERVISOR_FALLBACK_DENIED,
  WEBSITE_AI_SUPERVISOR_INVALID,
  WEBSITE_AI_VIDEO_USAGE_UNAVAILABLE,
];
const safePublicTrpcMessages = new Set([
  ...publicServiceErrors.map(({ code, message }) => `[${code}] ${message}`),
  '[TRAVEL_SPECIALIST_UNAVAILABLE] 对应的旅游制作助理尚未配置，请先由管理员完成群成员配置。',
  GENERATION_NOT_FOUND.message,
  'Topic not found',
  '幂等键已用于其他请求',
  '已有制作任务正在进行，请等待完成后再试',
  '请求过于频繁',
  '请求过于频繁，请稍后再试',
  '相同请求正在启动，请稍后重试',
  '重试状态已过期，请重新提交请求',
]);

type WebsiteAiStreamManager = ReturnType<WebsiteAiService['streamManager']>;

const parseWebsiteAiResumeCursor = (cursor: string) => {
  if (!publicFrameCursorSchema.safeParse(cursor).success) {
    return { subscriptionCursor: cursor };
  }

  const separator = cursor.lastIndexOf('.');
  return {
    resumeAfter: {
      frameIndex: Number(cursor.slice(separator + 1)),
      runtimeCursor: cursor.slice(0, separator),
    },
    // Redis XREAD starts after its cursor. Replay reconstructs progress state
    // and makes the rest of this one expanded runtime event recoverable.
    subscriptionCursor: '0',
  };
};

const compareRuntimeCursors = (left: string, right: string) => {
  const [leftTime, leftSequence] = left.split('-').map(BigInt);
  const [rightTime, rightSequence] = right.split('-').map(BigInt);
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
  if (leftSequence === rightSequence) return 0;
  return leftSequence < rightSequence ? -1 : 1;
};

const publicFrameCursor = (runtimeCursor: unknown, frameIndex: number) => {
  if (!runtimeStreamCursorSchema.safeParse(runtimeCursor).success) return undefined;
  return `${runtimeCursor}.${frameIndex}`;
};

const createWebsiteAiStreamResponse = (input: {
  cursor: string;
  manager: WebsiteAiStreamManager;
  operationId: string;
  previousTurnHandle?: WebsiteAiPreviousTurnHandle;
  progressMembers: Array<{ id: string; name: string }>;
  publicOrigin: string;
  refreshSlot: () => Promise<boolean>;
  releaseSlot: () => Promise<void>;
  requestSignal: AbortSignal;
  responseDelivery?: typeof WEBSITE_AI_SETTLEMENT_GATED_TEXT;
  topicId: string;
}) => {
  const {
    cursor,
    operationId,
    previousTurnHandle,
    progressMembers,
    publicOrigin,
    refreshSlot,
    releaseSlot,
    requestSignal,
    responseDelivery,
    topicId,
  } = input;
  const resume = parseWebsiteAiResumeCursor(cursor);
  let resumeReached = !resume.resumeAfter;
  let manager: WebsiteAiStreamManager | undefined = input.manager;
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const settlementGatedText = responseDelivery === WEBSITE_AI_SETTLEMENT_GATED_TEXT;
  const gatedEvents: Array<{
    event: { type: string } & Record<string, unknown>;
    id?: string;
  }> = [];
  let gatedBytes = 0;
  const state: {
    controller?: ReadableStreamDefaultController<Uint8Array>;
    heartbeat?: ReturnType<typeof setInterval>;
    lastRuntimeEventAt: number;
    open: boolean;
    progress?: ReturnType<typeof createWebsiteAiProgressTracker>;
    refreshing: boolean;
    releasePromise?: Promise<void>;
    sentBytes: number;
    sentEvents: number;
  } = {
    lastRuntimeEventAt: Date.now(),
    open: true,
    progress: createWebsiteAiProgressTracker(progressMembers),
    refreshing: false,
    sentBytes: 0,
    sentEvents: 0,
  };

  const release = (): Promise<void> => {
    if (state.releasePromise) return state.releasePromise;
    if (!state.open) return Promise.resolve();
    state.open = false;
    if (state.heartbeat) clearInterval(state.heartbeat);
    state.heartbeat = undefined;
    state.controller = undefined;
    state.progress = undefined;
    abortController.abort();
    requestSignal.removeEventListener('abort', releaseFromRequest);
    state.releasePromise = Promise.resolve()
      .then(releaseSlot)
      .catch(() => undefined);
    return state.releasePromise;
  };
  const releaseFromRequest = () => {
    if (!state.open) return;
    const activeController = state.controller;
    void release().then(() => activeController?.close());
  };

  const body = new ReadableStream<Uint8Array>(
    {
      cancel: release,
      start(controller) {
        state.controller = controller;
        if (requestSignal.aborted) {
          const activeController = state.controller;
          void release().then(() => activeController?.close());
          return;
        }
        requestSignal.addEventListener('abort', releaseFromRequest, { once: true });
        const close = async (taskStatus?: 'failed' | 'succeeded') => {
          if (!state.open) return;
          const activeController = state.controller;
          const releasePromise = release();
          if (taskStatus && previousTurnHandle) {
            await Promise.all([
              releasePromise,
              websiteAiPreviousTurnStore.settle(previousTurnHandle, taskStatus),
            ]);
          } else {
            await releasePromise;
          }
          activeController?.close();
        };
        const encodeEvent = (event: { type: string } & Record<string, unknown>, id?: string) => {
          const parsedId = streamCursorSchema.safeParse(id);
          const eventCursor = id && parsedId.success ? `id: ${id}\n` : '';
          return encoder.encode(
            `${eventCursor}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
        };
        const enqueueTerminal = (event: { type: string } & Record<string, unknown>) => {
          if (!state.open || !state.controller) return false;
          const chunk = encodeEvent(event);
          if ((state.controller.desiredSize ?? 0) < chunk.byteLength) return false;
          state.controller.enqueue(chunk);
          return true;
        };
        const finishWithError = (code: string, message: string, reason: string) => {
          if (!state.open) return;
          enqueueTerminal({ code, message, type: 'error' });
          enqueueTerminal({ reason, type: 'done' });
          void close();
        };
        const send = (event: { type: string } & Record<string, unknown>, id?: string) => {
          if (!state.open || !state.controller) return false;
          if (
            Object.values(event).some(
              (value) => typeof value === 'string' && value.length > WEBSITE_AI_MAX_SSE_EVENT_BYTES,
            )
          ) {
            finishWithError(
              'STREAM_LIMIT',
              '输出内容超过安全限制，请缩短请求后重试。',
              'stream_limit',
            );
            return false;
          }
          const chunk = encodeEvent(event, id);
          if (
            chunk.byteLength > WEBSITE_AI_MAX_SSE_EVENT_BYTES ||
            state.sentEvents >= WEBSITE_AI_MAX_SSE_EVENTS ||
            state.sentBytes + chunk.byteLength > WEBSITE_AI_MAX_SSE_TOTAL_BYTES
          ) {
            finishWithError(
              'STREAM_LIMIT',
              '输出内容超过安全限制，请缩短请求后重试。',
              'stream_limit',
            );
            return false;
          }
          if (
            (state.controller.desiredSize ?? 0) <
            chunk.byteLength + WEBSITE_AI_SSE_TERMINAL_RESERVE_BYTES
          ) {
            finishWithError(
              'STREAM_BACKPRESSURE',
              '客户端接收速度过慢，连接已安全关闭，请重试。',
              'stream_backpressure',
            );
            return false;
          }
          state.controller.enqueue(chunk);
          state.sentBytes += chunk.byteLength;
          state.sentEvents += 1;
          return true;
        };
        const queueGated = (event: { type: string } & Record<string, unknown>, id?: string) => {
          if (
            Object.values(event).some(
              (value) => typeof value === 'string' && value.length > WEBSITE_AI_MAX_SSE_EVENT_BYTES,
            )
          ) {
            gatedEvents.length = 0;
            gatedBytes = 0;
            finishWithError(
              'STREAM_LIMIT',
              '输出内容超过安全限制，请缩短请求后重试。',
              'stream_limit',
            );
            return false;
          }
          const chunk = encodeEvent(event, id);
          if (
            chunk.byteLength > WEBSITE_AI_MAX_SSE_EVENT_BYTES ||
            state.sentEvents + gatedEvents.length >= WEBSITE_AI_MAX_SSE_EVENTS ||
            state.sentBytes + gatedBytes + chunk.byteLength > WEBSITE_AI_MAX_SSE_TOTAL_BYTES
          ) {
            gatedEvents.length = 0;
            gatedBytes = 0;
            finishWithError(
              'STREAM_LIMIT',
              '输出内容超过安全限制，请缩短请求后重试。',
              'stream_limit',
            );
            return false;
          }
          gatedEvents.push({ event, id });
          gatedBytes += chunk.byteLength;
          return true;
        };

        send({ message: '已接收任务', status: 'queued', topicId, type: 'status' });
        state.heartbeat = setInterval(() => {
          if (!state.open || !state.controller) return;
          if (Date.now() - state.lastRuntimeEventAt >= WEBSITE_AI_IDLE_TIMEOUT_MS) {
            finishWithError('STREAM_TIMEOUT', '任务长时间无响应，请重试。', 'stream_timeout');
            return;
          }
          if (state.refreshing) return;
          state.refreshing = true;
          void refreshSlot()
            .catch(() => false)
            .then((refreshed) => {
              if (!state.open || !state.controller) return;
              if (!refreshed) {
                finishWithError(
                  'STREAM_INCOMPLETE',
                  '任务连接已中断，请重试。',
                  'stream_incomplete',
                );
                return;
              }
              const heartbeat = encoder.encode(': heartbeat\n\n');
              if (state.sentBytes + heartbeat.byteLength > WEBSITE_AI_MAX_SSE_TOTAL_BYTES) {
                finishWithError(
                  'STREAM_LIMIT',
                  '输出内容超过安全限制，请缩短请求后重试。',
                  'stream_limit',
                );
                return;
              }
              if (
                (state.controller.desiredSize ?? 0) <
                heartbeat.byteLength + WEBSITE_AI_SSE_TERMINAL_RESERVE_BYTES
              ) {
                finishWithError(
                  'STREAM_BACKPRESSURE',
                  '客户端接收速度过慢，连接已安全关闭，请重试。',
                  'stream_backpressure',
                );
                return;
              }
              state.controller.enqueue(heartbeat);
              state.sentBytes += heartbeat.byteLength;
            })
            .finally(() => {
              state.refreshing = false;
            });
        }, WEBSITE_AI_HEARTBEAT_INTERVAL_MS);

        const subscription = manager!.subscribeStreamEvents(
          operationId,
          resume.subscriptionCursor,
          (events) => {
            if (!state.open) return;
            if (events.length > 0) state.lastRuntimeEventAt = Date.now();
            for (const event of events) {
              if (!state.open || !state.progress) return;
              const normalizedEvents = normalizeWebsiteAiStreamEvent(
                event,
                state.progress,
                publicOrigin,
              );
              let taskStatus: 'failed' | 'succeeded' = 'failed';
              let firstPublicFrame = 0;
              if (resume.resumeAfter && !resumeReached) {
                if (!runtimeStreamCursorSchema.safeParse(event.id).success) {
                  finishWithError(
                    'STREAM_INCOMPLETE',
                    '任务连接已中断，请重试。',
                    'stream_incomplete',
                  );
                  return;
                }
                const comparison = compareRuntimeCursors(
                  event.id!,
                  resume.resumeAfter.runtimeCursor,
                );
                if (comparison < 0) continue;
                if (comparison > 0) {
                  finishWithError(
                    'STREAM_INCOMPLETE',
                    '任务连接已中断，请重试。',
                    'stream_incomplete',
                  );
                  return;
                }
                resumeReached = true;
                firstPublicFrame = resume.resumeAfter.frameIndex + 1;
              }
              for (const [frameIndex, normalized] of normalizedEvents.entries()) {
                if (normalized.type === 'done' && normalized.reason === 'completed') {
                  taskStatus = 'succeeded';
                }
                if (frameIndex < firstPublicFrame) continue;
                const frameCursor = publicFrameCursor(event.id, frameIndex);
                if (settlementGatedText && event.type !== 'agent_runtime_end') {
                  queueGated(normalized, frameCursor);
                } else if (!settlementGatedText) {
                  send(normalized, frameCursor);
                }
              }
              if (event.type === 'agent_runtime_end') {
                if (settlementGatedText) {
                  if (taskStatus === 'succeeded') {
                    for (const pending of gatedEvents) {
                      if (!send(pending.event, pending.id)) break;
                    }
                    gatedEvents.length = 0;
                    gatedBytes = 0;
                    if (state.open) {
                      for (const [frameIndex, normalized] of normalizedEvents.entries()) {
                        if (frameIndex < firstPublicFrame) continue;
                        send(normalized, publicFrameCursor(event.id, frameIndex));
                      }
                    }
                  } else {
                    gatedEvents.length = 0;
                    gatedBytes = 0;
                    for (const [frameIndex, normalized] of normalizedEvents.entries()) {
                      if (frameIndex < firstPublicFrame) continue;
                      if (normalized.type === 'error' || normalized.type === 'done') {
                        send(normalized, publicFrameCursor(event.id, frameIndex));
                      }
                    }
                  }
                }
                void close(taskStatus);
                return;
              }
            }
          },
          abortController.signal,
        );
        manager = undefined;

        void subscription
          .then(() => {
            finishWithError('STREAM_INCOMPLETE', '任务连接已中断，请重试。', 'stream_incomplete');
          })
          .catch(() => {
            finishWithError('STREAM_ERROR', '任务连接已中断，请重试。', 'stream_error');
          });
      },
    },
    {
      highWaterMark: WEBSITE_AI_MAX_BUFFERED_SSE_BYTES,
      size: (chunk) => chunk.byteLength,
    },
  );

  return new Response(body, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
};

const configuredPublicOrigin = () => {
  if (!appEnv.APP_URL) return undefined;
  try {
    return new URL(appEnv.APP_URL).origin;
  } catch {
    return undefined;
  }
};

export const trustedWebsiteAiOrigin = (request: Request) => {
  const origin = request.headers.get('origin');
  if (!origin) return undefined;
  const requestOrigin = new URL(request.url).origin;
  return origin === requestOrigin || origin === configuredPublicOrigin() ? origin : undefined;
};

const hasTrustedOrigin = (request: Request) => Boolean(trustedWebsiteAiOrigin(request));
const hasJsonContentType = (request: Request) => {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'application/json' || Boolean(mediaType?.endsWith('+json'));
};

const getWebsiteAiAccess = async (c: Context) => {
  try {
    const db = await getServerDB();
    const session = await getActiveSession(c.req.raw.headers, db);
    const userId = session?.user?.id;
    if (!userId) return undefined;

    const account = await UserModel.findById(db, userId);
    if (!account || account.emailVerified !== true || account.banned === true) return undefined;

    return { db, session, userId };
  } catch {
    return undefined;
  }
};

const rejectUnavailableAccount = (c: Context) => c.json({ error: ACCOUNT_UNAVAILABLE }, 401);
const createAccountFingerprint = (userId: string) => {
  if (!authEnv.AUTH_SECRET) throw new Error('Website AI account fingerprint secret unavailable');

  return createHmac('sha256', authEnv.AUTH_SECRET)
    .update('website-ai-account-fingerprint:v1\0')
    .update(userId)
    .digest('hex');
};
const createWebsiteAiRequestIdentity = (userId: string, idempotencyKey: string) => {
  if (!authEnv.AUTH_SECRET) throw new Error('Website AI request identity secret unavailable');

  const digest = createHmac('sha256', authEnv.AUTH_SECRET)
    .update('website-ai-request-budget:v1\0')
    .update(userId)
    .update('\0')
    .update(idempotencyKey)
    .digest('hex');
  return `website-ai:v1:${digest}`;
};
const generationNotFound = () =>
  new TRPCError({ code: GENERATION_NOT_FOUND.code, message: GENERATION_NOT_FOUND.message });

type WebsiteAiErrorStatus = 400 | 401 | 403 | 404 | 409 | 412 | 429 | 500;

const genericPublicTrpcMessage = (code: TRPCError['code']) => {
  if (code === 'UNAUTHORIZED') return '请先登录后重试。';
  if (code === 'FORBIDDEN') return '请求被拒绝。';
  if (code === 'NOT_FOUND') return '请求的资源不存在。';
  if (code === 'CONFLICT') return '请求状态冲突，请重新提交。';
  if (code === 'PRECONDITION_FAILED') return '当前条件不满足，请稍后重试。';
  if (code === 'TOO_MANY_REQUESTS') return '请求过于频繁，请稍后再试。';
  return '请求无效，请检查后重试。';
};

const publicError = (
  error: unknown,
): { body: { error: { code: string; message: string } }; status: WebsiteAiErrorStatus } => {
  if (error instanceof TRPCError) {
    if (error.code === 'INTERNAL_SERVER_ERROR') {
      return {
        body: { error: { code: 'INTERNAL_ERROR', message: '官网 AI 服务暂时不可用。' } },
        status: 500,
      };
    }
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'CONFLICT'
          ? 409
          : error.code === 'PRECONDITION_FAILED'
            ? 412
            : error.code === 'TOO_MANY_REQUESTS'
              ? 429
              : error.code === 'FORBIDDEN'
                ? 403
                : error.code === 'UNAUTHORIZED'
                  ? 401
                  : 400;
    const message = safePublicTrpcMessages.has(error.message)
      ? error.message
      : genericPublicTrpcMessage(error.code);
    return { body: { error: { code: error.code, message } }, status };
  }
  return {
    body: { error: { code: 'INTERNAL_ERROR', message: '官网 AI 服务暂时不可用。' } },
    status: 500,
  };
};

export const getWebsiteAiSession = async (c: Context) => {
  const access = await getWebsiteAiAccess(c);
  if (!access) return rejectUnavailableAccount(c);
  try {
    const capabilities = await getWebsiteAiCapabilities(access.db, access.userId);
    const publicCapability = (capability?: { available: boolean; reasonCode?: string }) => ({
      available: capability?.available === true,
      ...(capability?.reasonCode === WEBSITE_AI_PRODUCTION_CAPABILITY_UNAVAILABLE.code
        ? { reasonCode: capability.reasonCode }
        : {}),
    });
    return c.json({
      accountFingerprint: createAccountFingerprint(access.userId),
      authenticated: true,
      capabilities: {
        copy: publicCapability(capabilities.copy),
        document: publicCapability(capabilities.document),
        image: publicCapability(capabilities.image),
        submission: publicCapability(capabilities.copy),
        video: publicCapability(capabilities.video),
      },
      user: {
        name: typeof access.session.user.name === 'string' ? access.session.user.name : null,
      },
    });
  } catch (error) {
    const { body, status } = publicError(error);
    return c.json(body, status);
  }
};

export const getWebsiteAiGenerationStatus = async (c: Context) => {
  if (!hasTrustedOrigin(c.req.raw)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Request origin rejected' } }, 403);
  }
  const access = await getWebsiteAiAccess(c);
  if (!access) return rejectUnavailableAccount(c);
  if (!hasJsonContentType(c.req.raw)) {
    return c.json(
      { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'JSON content type required' } },
      415,
    );
  }
  const parsed = generationStatusSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid task request' } }, 422);
  }

  try {
    const groupModel = new ChatGroupModel(access.db, access.userId);
    const [group, storedTask] = await Promise.all([
      groupModel.findByClientId(DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
      new TravelGenerationTaskModel(access.db, access.userId).findById(parsed.data.taskId),
    ]);
    if (
      !group ||
      group.visibility !== 'private' ||
      !storedTask ||
      storedTask.id !== parsed.data.taskId ||
      storedTask.userId !== access.userId ||
      storedTask.groupId !== group.id
    ) {
      throw generationNotFound();
    }

    const [{ createTravelGenerationSettlementService }, { toPublicTravelGenerationTask }] =
      await Promise.all([
        import('@/server/services/travelGeneration/production'),
        import('@/server/services/travelGeneration/public'),
      ]);
    const settlement = createTravelGenerationSettlementService({
      db: access.db,
      userId: access.userId,
    });
    const task = await settlement.reconcile(parsed.data.taskId);
    const currentGroup = await groupModel.findByClientId(DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID);
    if (
      !task ||
      !currentGroup ||
      currentGroup.id !== group.id ||
      currentGroup.visibility !== 'private' ||
      task.id !== parsed.data.taskId ||
      task.owner.userId !== access.userId ||
      task.owner.groupId !== currentGroup.id
    ) {
      throw generationNotFound();
    }
    const publicTask = toPublicTravelGenerationTask(task);
    return c.json({
      artifacts: publicTask.artifacts.flatMap(({ id, name, type, url }) => {
        if (typeof id !== 'string' || !id) return [];
        const publicUrl = normalizeWebsiteAiArtifactUrl(url, trustedWebsiteAiOrigin(c.req.raw));
        return [
          {
            id,
            ...(typeof name === 'string' && name ? { name } : {}),
            type,
            ...(publicUrl ? { url: publicUrl } : {}),
          },
        ];
      }),
      id: publicTask.id,
      status: publicTask.status,
      type: publicTask.type,
    });
  } catch (error) {
    const { body, status } = publicError(error);
    return c.json(body, status);
  }
};

export const startWebsiteAiChat = async (c: Context) => {
  if (!hasTrustedOrigin(c.req.raw)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Request origin rejected' } }, 403);
  }
  const access = await getWebsiteAiAccess(c);
  if (!access) return rejectUnavailableAccount(c);
  if (!hasJsonContentType(c.req.raw)) {
    return c.json(
      { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'JSON content type required' } },
      415,
    );
  }
  const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid chat request' } }, 422);
  }
  const parsedIdempotencyKey = idempotencyKeySchema.safeParse(
    c.req.header('Idempotency-Key') ?? undefined,
  );
  if (!parsedIdempotencyKey.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid idempotency key' } }, 422);
  }
  const parsedCursor = streamCursorSchema.safeParse(c.req.header('Last-Event-ID') ?? '0');
  if (!parsedCursor.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid stream cursor' } }, 422);
  }
  if (parsedCursor.data !== '0' && !parsedIdempotencyKey.data) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Stream cursor requires idempotency key' } },
      422,
    );
  }

  try {
    const slot = await websiteAiInFlightLimiter.acquire(access.userId);
    if (!slot) {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: '请求过于频繁，请稍后再试。' });
    }
    const [{ runWebsiteAiStartIdempotently }, { WebsiteAiService }] = await Promise.all([
      import('@/server/services/websiteAi/idempotency'),
      import('@/server/services/websiteAi'),
    ]);
    try {
      const service = new WebsiteAiService(access.db, access.userId);
      const result = await runWebsiteAiStartIdempotently({
        idempotencyKey: parsedIdempotencyKey.data,
        maxCredits: parsed.data.maxCredits,
        message: parsed.data.prompt,
        requireExisting: parsedCursor.data !== '0',
        start: () =>
          service.start({
            ...(parsed.data.maxCredits === undefined ? {} : { maxCredits: parsed.data.maxCredits }),
            message: parsed.data.prompt,
            requestIdentity: createWebsiteAiRequestIdentity(
              access.userId,
              parsedIdempotencyKey.data,
            ),
            topicId: parsed.data.topicId,
          }),
        topicId: parsed.data.topicId,
        userId: access.userId,
      });
      if (!(await slot.refresh())) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: '请求过于频繁，请稍后再试。',
        });
      }
      return createWebsiteAiStreamResponse({
        cursor: parsedCursor.data,
        manager: service.streamManager(),
        operationId: result.operationId,
        previousTurnHandle: result.previousTurnHandle,
        progressMembers: result.progressMembers,
        publicOrigin: trustedWebsiteAiOrigin(c.req.raw)!,
        refreshSlot: slot.refresh,
        releaseSlot: slot.release,
        requestSignal: c.req.raw.signal,
        responseDelivery: result.responseDelivery,
        topicId: result.topicId,
      });
    } catch (error) {
      await slot.release();
      throw error;
    }
  } catch (error) {
    const { body, status } = publicError(error);
    if (status === 429) c.header('Retry-After', '60');
    return c.json(body, status);
  }
};
