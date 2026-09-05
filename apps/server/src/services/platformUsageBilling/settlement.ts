import { type LobeChatDatabase, PlatformCreditModel } from '@lobechat/database';

import type { ModelUsage } from '@/types/message';

import { preparePlatformUsageCharge } from './index';

const AGENT_RUNTIME_TEXT_STEP = 'agent-runtime-text-step';

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
  if (balanceCredits <= 0) {
    throw new PlatformManagedTextUsageSettlementError(
      'BALANCE_EMPTY',
      'Platform-managed billing requires a positive Credits balance before the provider call.',
    );
  }
};

export type PlatformManagedTextUsageSettlementErrorCode =
  | 'BALANCE_EMPTY'
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
 * Credits gate and post-call settlement for trusted platform-managed text runs.
 *
 * `assertCanCallProvider` is intentionally only a positive-balance gate. It does
 * not reserve an estimated amount, so the actual post-call cost can still exceed
 * the remaining balance. `chargeUsage` is the atomic, row-locked debit and the
 * operation/step/call-kind idempotency key prevents a replay from charging twice.
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

      return await this.ledger.chargeUsage({
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

/**
 * Positive-balance gate plus post-provider atomic debit for platform-managed images.
 * The gate does not reserve an estimate; settlement is based only on response.modelUsage.
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

      return await this.ledger.chargeUsage({
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
