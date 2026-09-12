import { type LobeChatDatabase, PlatformCreditModel } from '@lobechat/database';

import { notifyCreditEntry } from '@/server/services/notification/credit';
import type { ModelUsage } from '@/types/message';

import { preparePlatformUsageCharge } from './index';

const AGENT_RUNTIME_TEXT_STEP = 'agent-runtime-text-step';
export const PLATFORM_MANAGED_MINIMUM_BALANCE_CREDITS = 50_000;

type PlatformCreditLedger = Pick<PlatformCreditModel, 'chargeUsage' | 'getAccount'>;

const assertCanCallProvider = async (ledger: PlatformCreditLedger): Promise<void> => {
  let balanceCredits: number;
  try {
    const account = await ledger.getAccount();
    balanceCredits = account.balanceCredits;
  } catch (cause) {
    throw new PlatformManagedTextUsageSettlementError(
      'BALANCE_LOOKUP_FAILED',
      'Platform-managed billing preflight could not read the Credits balance.',
      { cause },
    );
  }

  if (!Number.isSafeInteger(balanceCredits)) {
    throw new PlatformManagedTextUsageSettlementError(
      'BALANCE_INVALID',
      'Platform-managed billing preflight found an invalid Credits balance.',
    );
  }
  if (balanceCredits < PLATFORM_MANAGED_MINIMUM_BALANCE_CREDITS) {
    throw new PlatformManagedTextUsageSettlementError(
      'BALANCE_FLOOR_REACHED',
      '积分预算不足：当前可用积分低于 5 万，AI 任务已停止。',
    );
  }
};

export type PlatformManagedTextUsageSettlementErrorCode =
  | 'BALANCE_FLOOR_REACHED'
  | 'BALANCE_INVALID'
  | 'BALANCE_LOOKUP_FAILED'
  | 'INVALID_STEP_IDENTITY'
  | 'SETTLEMENT_FAILED';

export class PlatformManagedTextUsageSettlementError extends Error {
  readonly code: PlatformManagedTextUsageSettlementErrorCode;

  constructor(
    code: PlatformManagedTextUsageSettlementErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PlatformManagedTextUsageSettlementError';
    this.code = code;
  }
}

export interface SettlePlatformManagedTextStepInput {
  kind: 'call_llm' | 'compress_context';
  model: string;
  operationId: string;
  provider: string;
  stepIndex: number;
  usage?: ModelUsage;
  workspaceId?: string | null;
}

/**
 * Per-round balance gate plus post-call settlement for trusted platform-managed text runs.
 * No estimated amount is held: every completed round is charged from authoritative usage.
 */
export class PlatformManagedTextUsageSettlement {
  private readonly ledger: PlatformCreditLedger;

  constructor(
    db: LobeChatDatabase,
    private readonly actorUserId: string,
    ledger?: PlatformCreditLedger,
  ) {
    this.ledger = ledger ?? new PlatformCreditModel(db, actorUserId);
  }

  async assertCanCallProvider(): Promise<void> {
    await assertCanCallProvider(this.ledger);
  }

  async settleStep(input: SettlePlatformManagedTextStepInput) {
    const operationId = input.operationId.trim();
    const validKind = input.kind === 'call_llm' || input.kind === 'compress_context';
    if (
      !operationId ||
      !validKind ||
      !Number.isSafeInteger(input.stepIndex) ||
      input.stepIndex < 0
    ) {
      throw new PlatformManagedTextUsageSettlementError(
        'INVALID_STEP_IDENTITY',
        'Platform-managed billing requires an operation id and a non-negative safe step index.',
      );
    }

    const generationId = `${operationId}:step:${input.stepIndex}:${input.kind}`;

    try {
      const charge = preparePlatformUsageCharge({
        actorUserId: this.actorUserId,
        generationId,
        generationType: AGENT_RUNTIME_TEXT_STEP,
        model: input.model,
        provider: input.provider,
        usage: input.usage,
        workspaceId: input.workspaceId,
      });

      const entry = await this.ledger.chargeUsage({
        actorUserId: this.actorUserId,
        costUsd: charge.costUsd,
        credits: charge.credits,
        generationId,
        generationType: AGENT_RUNTIME_TEXT_STEP,
        idempotencyKey: charge.idempotency.key,
        model: input.model,
        provider: input.provider,
        tokenUsage: charge.tokens,
        workspaceId: input.workspaceId,
      });
      await notifyCreditEntry(entry);
      return entry;
    } catch (cause) {
      if (cause instanceof PlatformManagedTextUsageSettlementError) throw cause;
      throw new PlatformManagedTextUsageSettlementError(
        'SETTLEMENT_FAILED',
        'Platform-managed billing settlement failed; the model step is not settled.',
        { cause },
      );
    }
  }
}

export interface SettlePlatformManagedImageInput {
  asyncTaskId: string;
  generationId: string;
  model: string;
  provider: string;
  usage?: ModelUsage;
  workspaceId?: string | null;
}

export interface SettlePlatformManagedVideoInput {
  asyncTaskId: string;
  generationId: string;
  model: string;
  provider: string;
  usage?: ModelUsage;
  workspaceId?: string | null;
}

/**
 * Per-call balance gate plus post-provider actual-usage settlement for images.
 */
export class PlatformManagedImageUsageSettlement {
  private readonly ledger: PlatformCreditLedger;

  constructor(
    db: LobeChatDatabase,
    private readonly actorUserId: string,
    ledger?: PlatformCreditLedger,
  ) {
    this.ledger = ledger ?? new PlatformCreditModel(db, actorUserId);
  }

  async assertCanCallProvider(): Promise<void> {
    await assertCanCallProvider(this.ledger);
  }

  async settleImage(input: SettlePlatformManagedImageInput) {
    const asyncTaskId = input.asyncTaskId.trim();
    const sourceGenerationId = input.generationId.trim();
    if (!asyncTaskId || !sourceGenerationId) {
      throw new PlatformManagedTextUsageSettlementError(
        'INVALID_STEP_IDENTITY',
        'Platform-managed image billing requires an async task id and generation id.',
      );
    }

    const generationId = `${sourceGenerationId}:async-task:${asyncTaskId}:image`;
    const generationType = 'platform-managed-image';

    try {
      const charge = preparePlatformUsageCharge({
        actorUserId: this.actorUserId,
        generationId,
        generationType,
        model: input.model,
        provider: input.provider,
        usage: input.usage,
        workspaceId: input.workspaceId,
      });

      const entry = await this.ledger.chargeUsage({
        actorUserId: this.actorUserId,
        costUsd: charge.costUsd,
        credits: charge.credits,
        generationId,
        generationType,
        idempotencyKey: charge.idempotency.key,
        model: input.model,
        provider: input.provider,
        tokenUsage: charge.tokens,
        workspaceId: input.workspaceId,
      });
      await notifyCreditEntry(entry);
      return entry;
    } catch (cause) {
      if (cause instanceof PlatformManagedTextUsageSettlementError) throw cause;
      throw new PlatformManagedTextUsageSettlementError(
        'SETTLEMENT_FAILED',
        'Platform-managed image billing settlement failed; the image is not settled.',
        { cause },
      );
    }
  }
}

/**
 * Per-call balance gate plus post-provider actual-usage settlement for videos.
 *
 * Videos are never pre-charged: a completed generation reports its tokens only on
 * the provider callback, so the charge is written from that usage afterwards —
 * the same no-hold model as the platform text and image paths.
 */
export class PlatformManagedVideoUsageSettlement {
  private readonly ledger: PlatformCreditLedger;

  constructor(
    db: LobeChatDatabase,
    private readonly actorUserId: string,
    ledger?: PlatformCreditLedger,
  ) {
    this.ledger = ledger ?? new PlatformCreditModel(db, actorUserId);
  }

  async assertCanCallProvider(): Promise<void> {
    await assertCanCallProvider(this.ledger);
  }

  async settleVideo(input: SettlePlatformManagedVideoInput) {
    const asyncTaskId = input.asyncTaskId.trim();
    const sourceGenerationId = input.generationId.trim();
    if (!asyncTaskId || !sourceGenerationId) {
      throw new PlatformManagedTextUsageSettlementError(
        'INVALID_STEP_IDENTITY',
        'Platform-managed video billing requires an async task id and generation id.',
      );
    }

    const generationId = `${sourceGenerationId}:async-task:${asyncTaskId}:video`;
    const generationType = 'platform-managed-video';

    try {
      const charge = preparePlatformUsageCharge({
        actorUserId: this.actorUserId,
        generationId,
        generationType,
        model: input.model,
        provider: input.provider,
        usage: input.usage,
        workspaceId: input.workspaceId,
      });

      const entry = await this.ledger.chargeUsage({
        actorUserId: this.actorUserId,
        costUsd: charge.costUsd,
        credits: charge.credits,
        generationId,
        generationType,
        idempotencyKey: charge.idempotency.key,
        model: input.model,
        provider: input.provider,
        tokenUsage: charge.tokens,
        workspaceId: input.workspaceId,
      });
      await notifyCreditEntry(entry);
      return entry;
    } catch (cause) {
      if (cause instanceof PlatformManagedTextUsageSettlementError) throw cause;
      throw new PlatformManagedTextUsageSettlementError(
        'SETTLEMENT_FAILED',
        'Platform-managed video billing settlement failed; the video is not settled.',
        { cause },
      );
    }
  }
}
