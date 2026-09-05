import type { ModelUsage } from '@lobechat/types';
import debug from 'debug';

export type TravelGenerationType = 'copy' | 'document' | 'image' | 'video';
export type TravelGenerationStatus =
  'queued' | 'running' | 'pending' | 'succeeded' | 'failed' | 'unavailable';

export interface TravelGenerationOwner {
  groupId: string;
  userId: string;
  workspaceId?: string;
}

export interface TravelGenerationArtifact {
  asyncTaskId?: string;
  batchId?: string;
  content?: string;
  documentId?: string;
  fileId?: string;
  generationId?: string;
  mimeType?: string;
  name?: string;
  topicId?: string;
  type: 'document' | 'image' | 'task' | 'text' | 'video';
  url?: string;
}

export type TravelGenerationUsage = ModelUsage;

export interface TravelGenerationRequest {
  input: Record<string, unknown>;
  maxCredits?: number;
  orderId?: string;
  owner: TravelGenerationOwner;
  type: TravelGenerationType;
}

export interface TravelGenerationExecutionRequest extends TravelGenerationRequest {
  taskId: string;
}

export interface TravelGenerationRecord extends TravelGenerationRequest {
  artifacts?: TravelGenerationArtifact[];
  code?: 'ARTIFACT_PERSISTENCE_FAILED' | 'CAPABILITY_UNAVAILABLE' | 'GENERATION_FAILED';
  id: string;
  message?: string;
  provider?: string;
  status: TravelGenerationStatus;
  usage?: TravelGenerationUsage;
}

export interface TravelGenerationAdapterResult {
  artifacts: TravelGenerationArtifact[];
  provider?: string;
  status?: 'pending';
  usage?: TravelGenerationUsage;
}

export interface TravelGenerationAdapter {
  execute: (request: TravelGenerationExecutionRequest) => Promise<TravelGenerationAdapterResult>;
  type: TravelGenerationType;
}

export interface TravelGenerationRepository {
  create: (
    record: Omit<TravelGenerationRecord, 'id'>,
  ) => Promise<Omit<TravelGenerationRecord, 'id'> & { created?: boolean; id: string }>;
  transition?: (
    id: string,
    fromStatuses: TravelGenerationStatus[],
    patch: Partial<TravelGenerationRecord>,
  ) => Promise<boolean>;
  update: (id: string, patch: Partial<TravelGenerationRecord>) => Promise<unknown>;
}

export interface TravelGenerationOrchestratorOptions {
  adapters: TravelGenerationAdapter[];
  repository: TravelGenerationRepository;
}

export class TravelGenerationCapabilityUnavailableError extends Error {}

export class TravelGenerationIdempotencyConflictError extends Error {
  readonly code = 'TRAVEL_GENERATION_IDEMPOTENCY_CONFLICT';
}

export const TRAVEL_ARTIFACT_PERSISTENCE_PUBLIC_MESSAGE =
  '内容已生成并计费，但作品保存失败。请稍后重试查询或联系人工处理。';

/** Provider execution may already have side effects, so callers must not replay automatically. */
export class TravelGenerationNonReplayableError extends Error {
  constructor(cause: unknown) {
    super('Travel generation failed after execution started', { cause });
  }
}

/** Model usage is already settled, but the customer-owned artifact could not be persisted. */
export class TravelGenerationArtifactPersistenceError extends TravelGenerationNonReplayableError {}

/**
 * Unified, provider-neutral orchestration for travel-group creative tasks.
 *
 * Adapters bridge the existing LobeHub model/tool surfaces. The repository is
 * deliberately injected so deployments can persist to the established data
 * layer without coupling capability execution to one schema or provider.
 */
export class TravelGenerationOrchestrator {
  private readonly adapters: Map<TravelGenerationType, TravelGenerationAdapter>;
  private readonly repository: TravelGenerationRepository;

  constructor({ adapters, repository }: TravelGenerationOrchestratorOptions) {
    const duplicate = adapters.find(
      (adapter, index) =>
        adapters.findIndex((candidate) => candidate.type === adapter.type) !== index,
    );
    if (duplicate) throw new Error(`Duplicate travel generation adapter: ${duplicate.type}`);
    this.adapters = new Map(adapters.map((adapter) => [adapter.type, adapter]));
    this.repository = repository;
  }

  private async transition(
    id: string,
    fromStatuses: TravelGenerationStatus[],
    patch: Partial<TravelGenerationRecord>,
  ): Promise<boolean> {
    if (this.repository.transition) return this.repository.transition(id, fromStatuses, patch);
    await this.repository.update(id, patch);
    return true;
  }

  private async transitionAfterExecution(
    id: string,
    patch: Partial<TravelGenerationRecord>,
  ): Promise<void> {
    try {
      const updated = await this.transition(id, ['running'], patch);
      if (!updated) throw new Error('Travel generation terminal state was not persisted');
    } catch (error) {
      throw new TravelGenerationNonReplayableError(error);
    }
  }

  async run(request: TravelGenerationRequest): Promise<TravelGenerationRecord> {
    const created = await this.repository.create({ ...request, status: 'queued' });
    const { created: wasCreated, ...base } = created;
    if (wasCreated === false) return base;
    const adapter = this.adapters.get(request.type);

    if (!adapter) {
      const unavailable = {
        code: 'CAPABILITY_UNAVAILABLE' as const,
        message: `No enabled ${request.type} generation capability is available.`,
        status: 'unavailable' as const,
      };
      await this.transition(created.id, ['queued'], unavailable);
      return { ...base, ...unavailable };
    }

    const claimed = await this.transition(created.id, ['queued'], { status: 'running' });
    if (!claimed) throw new Error('Travel generation task could not be claimed');

    let result: TravelGenerationAdapterResult;
    try {
      result = await adapter.execute({ ...request, taskId: created.id });
      if (result.artifacts.length === 0) throw new Error('Provider returned no artifacts');
    } catch (error) {
      if (error instanceof TravelGenerationArtifactPersistenceError) {
        log('Travel generation failed: artifact-persistence-failed');
        const failed = {
          code: 'ARTIFACT_PERSISTENCE_FAILED' as const,
          message: TRAVEL_ARTIFACT_PERSISTENCE_PUBLIC_MESSAGE,
          status: 'failed' as const,
        };
        await this.transitionAfterExecution(created.id, failed);
        return { ...base, ...failed };
      }
      if (error instanceof TravelGenerationNonReplayableError) throw error;
      log(
        'Travel generation failed: %s',
        error instanceof TravelGenerationCapabilityUnavailableError
          ? 'capability-unavailable'
          : 'generation-failed',
      );
      if (error instanceof TravelGenerationCapabilityUnavailableError) {
        const unavailable = {
          code: 'CAPABILITY_UNAVAILABLE' as const,
          message: 'The requested generation capability is not currently available.',
          status: 'unavailable' as const,
        };
        await this.transitionAfterExecution(created.id, unavailable);
        return { ...base, ...unavailable };
      }
      const failed = {
        code: 'GENERATION_FAILED' as const,
        message: 'The generation provider could not complete this task.',
        status: 'failed' as const,
      };
      await this.transitionAfterExecution(created.id, failed);
      return { ...base, ...failed };
    }

    if (result.status === 'pending') {
      const pending = { ...result, status: 'pending' as const };
      await this.transitionAfterExecution(created.id, pending);
      return { ...base, ...pending };
    }
    const succeeded = { ...result, status: 'succeeded' as const };
    await this.transitionAfterExecution(created.id, succeeded);
    return { ...base, ...succeeded };
  }
}

const log = debug('lobe-server:travel-generation');
