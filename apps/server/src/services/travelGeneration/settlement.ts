import type { ModelUsage } from '@lobechat/types';

import { isSafeArtifactIdentifier, normalizeControlledArtifactUrl } from './artifactSafety';
import {
  TRAVEL_ARTIFACT_PERSISTENCE_PUBLIC_MESSAGE,
  type TravelGenerationArtifact,
  type TravelGenerationRecord,
} from './index';
import { buildPlatformImageSettlementIdentity } from './platformImageSettlementIdentity';

type SettlementPatch = Omit<Partial<TravelGenerationRecord>, 'code' | 'message'> & {
  code?: TravelGenerationRecord['code'] | null;
  message?: string | null;
};

export interface TravelGenerationSettlementRepository {
  findById: (id: string) => Promise<TravelGenerationRecord | null>;
  transition?: (
    id: string,
    fromStatuses: TravelGenerationRecord['status'][],
    patch: SettlementPatch,
  ) => Promise<boolean>;
  update: (id: string, patch: SettlementPatch) => Promise<unknown>;
}

export interface TravelGenerationSettlementRuntime {
  checkTimeoutTasks: (ids: string[]) => Promise<void>;
  findAsyncTask: (id: string) => Promise<{ metadata?: unknown; status: string | null } | null>;
  findGeneration: (
    id: string,
  ) => Promise<{ asset?: { type?: string; url?: string } | null; id: string } | null>;
  findPlatformImageReservation?: (id: string) => Promise<PlatformImageReservationRecord | null>;
  releasePlatformImageReservation?: (
    input: PlatformImageReservationLeaseInput & { completeRequest: true },
  ) => Promise<PlatformImageReservationRecord>;
  settlePlatformImageReservation?: (
    input: PlatformImageReservationLeaseInput & {
      providerRequestId?: string | null;
      usage: ModelUsage;
    },
  ) => Promise<PlatformImageReservationRecord>;
}

export interface PlatformImageReservationLeaseInput {
  leaseVersion: number;
  reservationId: string;
}

export interface PlatformImageReservationRecord {
  actualUsage?: ModelUsage | null;
  budgetId: string;
  callKind: string;
  generationId: string;
  generationType?: string | null;
  id: string;
  leaseVersion: number;
  model: string;
  provider: string;
  providerRequestId?: string | null;
  status: string;
  workspaceId?: string | null;
}

export interface PlatformImageRecoveryIdentity {
  generationId: string;
  model?: string;
  provider?: string;
  workspaceId?: string;
}

export type PlatformImageRecoveryOutcome =
  | { state: 'invalid' | 'not-platform' | 'provider-started' | 'released' | 'reserved' }
  | { reservation: PlatformImageReservationRecord; state: 'settled' };

type PlatformImageReservationHandle = PlatformImageReservationLeaseInput & { budgetId: string };

const readPlatformImageReservationHandle = (
  metadata: unknown,
): { handle?: PlatformImageReservationHandle; platform: boolean } => {
  if (!metadata || typeof metadata !== 'object') return { platform: false };
  const value = metadata as Record<string, unknown>;
  if (value.platformAiRuntime !== true) return { platform: false };
  const rawHandle = value.platformUsageReservation;
  if (!rawHandle || typeof rawHandle !== 'object') return { platform: true };
  const handle = rawHandle as Record<string, unknown>;
  if (
    typeof handle.budgetId !== 'string' ||
    !handle.budgetId ||
    !Number.isSafeInteger(handle.leaseVersion) ||
    Number(handle.leaseVersion) <= 0 ||
    typeof handle.reservationId !== 'string' ||
    !handle.reservationId
  ) {
    return { platform: true };
  }
  return {
    handle: {
      budgetId: handle.budgetId,
      leaseVersion: handle.leaseVersion as number,
      reservationId: handle.reservationId,
    },
    platform: true,
  };
};

export const recoverPlatformImageReservation = async (input: {
  allowReleaseReserved: boolean;
  identity: PlatformImageRecoveryIdentity;
  metadata: unknown;
  runtime: Pick<
    TravelGenerationSettlementRuntime,
    | 'findPlatformImageReservation'
    | 'releasePlatformImageReservation'
    | 'settlePlatformImageReservation'
  >;
}): Promise<PlatformImageRecoveryOutcome> => {
  const parsed = readPlatformImageReservationHandle(input.metadata);
  if (!parsed.platform) return { state: 'not-platform' };
  const { handle } = parsed;
  if (
    !handle ||
    !input.runtime.findPlatformImageReservation ||
    !input.runtime.releasePlatformImageReservation ||
    !input.runtime.settlePlatformImageReservation
  ) {
    return { state: 'invalid' };
  }

  const reservation = await input.runtime.findPlatformImageReservation(handle.reservationId);
  const settlementIdentity = buildPlatformImageSettlementIdentity(input.identity.generationId);
  if (
    !reservation ||
    reservation.id !== handle.reservationId ||
    reservation.budgetId !== handle.budgetId ||
    reservation.leaseVersion !== handle.leaseVersion ||
    reservation.generationId !== settlementIdentity.generationId ||
    reservation.generationType !== settlementIdentity.generationType ||
    reservation.callKind !== 'image' ||
    (reservation.workspaceId ?? null) !== (input.identity.workspaceId ?? null) ||
    (input.identity.model !== undefined && reservation.model !== input.identity.model) ||
    (input.identity.provider !== undefined && reservation.provider !== input.identity.provider)
  ) {
    return { state: 'invalid' };
  }

  if (reservation.status === 'provider_started') return { state: 'provider-started' };
  if (reservation.status === 'reserved') {
    if (!input.allowReleaseReserved) return { state: 'reserved' };
    const released = await input.runtime.releasePlatformImageReservation({
      completeRequest: true,
      leaseVersion: handle.leaseVersion,
      reservationId: handle.reservationId,
    });
    return released.status === 'released' ? { state: 'released' } : { state: 'invalid' };
  }
  if (reservation.status === 'provider_completed') {
    if (
      !reservation.actualUsage ||
      typeof reservation.actualUsage.cost !== 'number' ||
      !Number.isFinite(reservation.actualUsage.cost) ||
      reservation.actualUsage.cost < 0
    ) {
      return { state: 'invalid' };
    }
    const settled = await input.runtime.settlePlatformImageReservation({
      leaseVersion: handle.leaseVersion,
      providerRequestId: reservation.providerRequestId,
      reservationId: handle.reservationId,
      usage: reservation.actualUsage,
    });
    return settled.status === 'settled'
      ? { reservation: settled, state: 'settled' }
      : { state: 'invalid' };
  }
  if (reservation.status === 'settled') return { reservation, state: 'settled' };
  return { state: 'invalid' };
};

export interface TravelGenerationSettlementOptions {
  repository: TravelGenerationSettlementRepository;
  runtime: TravelGenerationSettlementRuntime;
}

const terminalStatuses = new Set<TravelGenerationRecord['status']>([
  'failed',
  'succeeded',
  'unavailable',
]);

/**
 * Reconciles LobeHub's provider-neutral async task state with the travel task.
 *
 * The service deliberately performs no generation work. It only observes owner-scoped
 * async tasks, resolves finished assets, and moves the task to one terminal outcome.
 */
export class TravelGenerationSettlementService {
  private readonly inFlight = new Map<string, Promise<TravelGenerationRecord | null>>();
  private readonly repository: TravelGenerationSettlementRepository;
  private readonly runtime: TravelGenerationSettlementRuntime;

  constructor({ repository, runtime }: TravelGenerationSettlementOptions) {
    this.repository = repository;
    this.runtime = runtime;
  }

  reconcile(taskId: string): Promise<TravelGenerationRecord | null> {
    const current = this.inFlight.get(taskId);
    if (current) return current;
    const pending = this.reconcileOnce(taskId).finally(() => this.inFlight.delete(taskId));
    this.inFlight.set(taskId, pending);
    return pending;
  }

  private async reconcileOnce(taskId: string): Promise<TravelGenerationRecord | null> {
    const task = await this.repository.findById(taskId);
    if (!task || terminalStatuses.has(task.status) || task.status !== 'pending') return task;

    if (task.type === 'copy' || task.type === 'document') {
      if (!task.artifacts?.length) {
        return this.fail(task, 'The generated work is unavailable.');
      }
      return this.succeed(task, task.artifacts);
    }

    const rawTaskArtifacts = task.artifacts?.filter((artifact) => artifact.type === 'task') ?? [];
    const taskArtifacts = rawTaskArtifacts.filter(
      (artifact) =>
        isSafeArtifactIdentifier(artifact.asyncTaskId) &&
        isSafeArtifactIdentifier(artifact.generationId),
    );
    if (
      (task.type !== 'image' && task.type !== 'video') ||
      taskArtifacts.length === 0 ||
      taskArtifacts.length !== rawTaskArtifacts.length
    ) {
      return this.fail(task, 'The generation task links are incomplete.');
    }

    let asyncTasks: Array<{ metadata?: unknown; status: string | null } | null>;
    try {
      await this.runtime.checkTimeoutTasks(taskArtifacts.map((artifact) => artifact.asyncTaskId!));
      asyncTasks = await Promise.all(
        taskArtifacts.map((artifact) => this.runtime.findAsyncTask(artifact.asyncTaskId!)),
      );
    } catch {
      return task;
    }

    if (asyncTasks.some((asyncTask) => !asyncTask)) {
      return this.fail(task, 'The generation task links are invalid.');
    }

    if (task.type === 'image') {
      let recovery: PlatformImageRecoveryOutcome[];
      try {
        recovery = await Promise.all(
          taskArtifacts.map((artifact, index) =>
            recoverPlatformImageReservation({
              allowReleaseReserved: asyncTasks[index]?.status === 'error',
              identity: {
                generationId: artifact.generationId!,
                workspaceId: task.owner.workspaceId,
              },
              metadata: asyncTasks[index]?.metadata,
              runtime: this.runtime,
            }),
          ),
        );
      } catch {
        return task;
      }

      const hasPlatformRecovery = recovery.some(({ state }) => state !== 'not-platform');
      if (hasPlatformRecovery) {
        if (recovery.some(({ state }) => state === 'invalid' || state === 'not-platform')) {
          return this.fail(task, 'Platform image recovery requires manual review.');
        }
        if (recovery.some(({ state }) => state === 'provider-started' || state === 'reserved')) {
          return task;
        }
        if (recovery.some(({ state }) => state === 'released')) {
          return this.fail(task, 'The generation provider could not complete this task.');
        }
        if (recovery.every(({ state }) => state === 'settled')) {
          let resolvedArtifacts: TravelGenerationArtifact[] | null;
          try {
            resolvedArtifacts = await this.resolveArtifacts(task, taskArtifacts);
          } catch {
            return task;
          }
          if (!resolvedArtifacts) return this.failArtifactPersistence(task);
          return this.succeed(task, resolvedArtifacts);
        }
      }
    }

    if (asyncTasks.some((asyncTask) => asyncTask?.status === 'error')) {
      return this.fail(task, 'The generation provider could not complete this task.');
    }
    if (asyncTasks.some((asyncTask) => asyncTask?.status !== 'success')) return task;

    let resolvedArtifacts: TravelGenerationArtifact[] | null;
    try {
      resolvedArtifacts = await this.resolveArtifacts(task, taskArtifacts);
    } catch {
      return task;
    }
    if (!resolvedArtifacts) {
      return this.fail(task, 'The generated asset is unavailable.');
    }

    return this.succeed(task, resolvedArtifacts);
  }

  private async persist(
    task: TravelGenerationRecord,
    patch: SettlementPatch,
  ): Promise<TravelGenerationRecord> {
    const updated = this.repository.transition
      ? await this.repository.transition(task.id, ['pending'], patch)
      : await this.repository.update(task.id, patch).then(() => true);
    if (!updated) return (await this.repository.findById(task.id)) ?? task;
    return { ...task, ...patch } as TravelGenerationRecord;
  }

  private async fail(
    task: TravelGenerationRecord,
    message: string,
  ): Promise<TravelGenerationRecord> {
    return this.persist(task, { code: 'GENERATION_FAILED', message, status: 'failed' });
  }

  private async failArtifactPersistence(
    task: TravelGenerationRecord,
  ): Promise<TravelGenerationRecord> {
    return this.persist(task, {
      code: 'ARTIFACT_PERSISTENCE_FAILED',
      message: TRAVEL_ARTIFACT_PERSISTENCE_PUBLIC_MESSAGE,
      status: 'failed',
    });
  }

  private async succeed(
    task: TravelGenerationRecord,
    artifacts: TravelGenerationArtifact[],
  ): Promise<TravelGenerationRecord> {
    const patch: SettlementPatch = {
      artifacts,
      code: null,
      message: null,
      status: 'succeeded',
    };
    const updated = this.repository.transition
      ? await this.repository.transition(task.id, ['pending'], patch)
      : await this.repository.update(task.id, patch).then(() => true);
    if (!updated) return (await this.repository.findById(task.id)) ?? task;
    return {
      ...task,
      artifacts,
      code: undefined,
      message: undefined,
      status: 'succeeded',
    };
  }

  private async resolveArtifacts(
    task: TravelGenerationRecord,
    taskArtifacts: TravelGenerationArtifact[],
  ): Promise<TravelGenerationArtifact[] | null> {
    const resolved = await Promise.all(
      taskArtifacts.map(async (artifact) => {
        const generation = await this.runtime.findGeneration(artifact.generationId!);
        const url = normalizeControlledArtifactUrl(generation?.asset?.url);
        if (!generation || generation.id !== artifact.generationId || !url) return null;
        return {
          ...artifact,
          type: task.type === 'video' ? ('video' as const) : ('image' as const),
          url,
        };
      }),
    );
    if (resolved.some((artifact) => !artifact)) return null;

    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    const uniqueResolved = resolved.filter((artifact): artifact is TravelGenerationArtifact => {
      if (!artifact?.generationId || !artifact.url) return false;
      if (seenIds.has(artifact.generationId) || seenUrls.has(artifact.url)) return false;
      seenIds.add(artifact.generationId);
      seenUrls.add(artifact.url);
      return true;
    });
    return [
      ...(task.artifacts ?? []).filter((artifact) => artifact.type !== 'task'),
      ...uniqueResolved,
    ];
  }
}
