import { AsyncTaskStatus } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { FileModel } from '@/database/models/file';
import { GenerationModel } from '@/database/models/generation';
import { TravelGenerationTaskModel } from '@/database/models/travelGeneration';
import { FileService } from '@/server/services/file';
import { hasSettledTravelImageUsage } from '@/server/services/travelGeneration/artifactAccess';
import {
  isSafeArtifactIdentifier,
  normalizeControlledArtifactUrl,
} from '@/server/services/travelGeneration/artifactSafety';

const notFound = () => new Response('Artifact not found', { status: 404 });
const allowedImageTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const byteRangePattern = /^bytes=(?:\d+-\d*|-\d+)$/;
const contentRangePattern = /^bytes \d+-\d+\/(?:\d+|\*)$/;
const unsignedIntegerPattern = /^\d+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const encodeDispositionFileName = (value: unknown): string => {
  const normalized =
    typeof value === 'string' && value.trim()
      ? value.trim().normalize('NFC').slice(0, 180)
      : 'image';
  return encodeURIComponent(normalized).replaceAll(
    /[!'()*]/g,
    (character) => `%${character.codePointAt(0)!.toString(16).toUpperCase()}`,
  );
};

type ArtifactRouteContext = {
  params: Promise<{ artifactId: string; taskId: string }>;
};

const authenticatedArtifactRoute = checkAuth(async (request, { params, serverDB, userId }) => {
  const { artifactId, taskId } = (await params) as unknown as {
    artifactId?: string;
    taskId?: string;
  };
  const requestUrl = new URL(request.url);
  const searchKeys = [...requestUrl.searchParams.keys()];
  const workspaceValues = requestUrl.searchParams.getAll('workspaceId');
  const downloadValues = requestUrl.searchParams.getAll('download');
  const workspaceId = workspaceValues[0];
  const download = downloadValues[0] === '1';
  const range = request.headers.get('range');

  if (
    !isSafeArtifactIdentifier(taskId) ||
    !isSafeArtifactIdentifier(artifactId) ||
    searchKeys.some((key) => key !== 'workspaceId' && key !== 'download') ||
    workspaceValues.length > 1 ||
    downloadValues.length > 1 ||
    (workspaceValues.length === 1 && !isSafeArtifactIdentifier(workspaceId)) ||
    (downloadValues.length === 1 && downloadValues[0] !== '1') ||
    (range !== null && (range.length > 128 || !byteRangePattern.test(range)))
  ) {
    return notFound();
  }

  const taskModel = new TravelGenerationTaskModel(serverDB, userId, workspaceId || undefined);
  const task = await taskModel.findById(taskId);
  if (
    task?.id !== taskId ||
    task.type !== 'image' ||
    task.status !== 'succeeded' ||
    !Array.isArray(task.artifacts) ||
    task.artifacts.length !== 1
  ) {
    return notFound();
  }
  const artifact = task.artifacts.find(
    (item) => isRecord(item) && item.type === 'image' && item.generationId === artifactId,
  );
  if (!isRecord(artifact)) return notFound();
  const controlledArtifactUrl = normalizeControlledArtifactUrl(artifact.url);
  if (!controlledArtifactUrl) return notFound();

  const generationModel = new GenerationModel(serverDB, userId, workspaceId || undefined);
  const generation = await generationModel.findByIdWithAsyncTask(artifactId);
  const asset = generation?.asset;
  if (
    generation?.id !== artifactId ||
    !isSafeArtifactIdentifier(generation.fileId) ||
    !isSafeArtifactIdentifier(generation.asyncTask?.id) ||
    generation.asyncTask?.status !== AsyncTaskStatus.Success ||
    !asset ||
    asset.type !== 'image'
  ) {
    return notFound();
  }

  let settled: boolean;
  try {
    settled = await hasSettledTravelImageUsage({
      asyncTaskId: generation.asyncTask.id,
      db: serverDB,
      generationId: artifactId,
      userId,
      workspaceId: workspaceId || undefined,
    });
  } catch {
    return notFound();
  }
  if (!settled) return notFound();

  const fileModel = new FileModel(serverDB, userId, workspaceId || undefined);
  const file = await fileModel.findById(generation.fileId);
  const metadata = isRecord(file?.metadata) ? file.metadata : undefined;
  const contentType = file?.fileType?.toLowerCase();
  if (
    !file?.url ||
    file.id !== generation.fileId ||
    asset.url !== file.url ||
    metadata?.generationId !== artifactId ||
    !contentType ||
    !allowedImageTypes.has(contentType) ||
    controlledArtifactUrl !== `/f/${file.id}`
  ) {
    return notFound();
  }

  try {
    const fileService = new FileService(serverDB, userId, workspaceId || undefined);
    const signedUrl = await fileService.createCachedPreSignedUrlForPreview(file.url);
    const parsedSignedUrl = new URL(signedUrl);
    if (
      (parsedSignedUrl.protocol !== 'https:' && parsedSignedUrl.protocol !== 'http:') ||
      parsedSignedUrl.username ||
      parsedSignedUrl.password
    ) {
      return notFound();
    }

    const upstreamHeaders: Record<string, string> = range ? { Range: range } : {};
    const upstream = await fetch(signedUrl, { headers: upstreamHeaders, redirect: 'error' });
    if ((range && upstream.status !== 206) || (!range && upstream.status !== 200))
      return notFound();

    const headers = new Headers({
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeDispositionFileName(file.name)}`,
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    });
    const contentLength = upstream.headers.get('content-length');
    if (contentLength && unsignedIntegerPattern.test(contentLength)) {
      headers.set('Content-Length', contentLength);
    }
    if (range) {
      const contentRange = upstream.headers.get('content-range');
      if (
        upstream.headers.get('accept-ranges') !== 'bytes' ||
        !contentRange ||
        !contentRangePattern.test(contentRange)
      ) {
        return notFound();
      }
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Content-Range', contentRange);
    }

    return new Response(upstream.body, { headers, status: upstream.status });
  } catch {
    return notFound();
  }
});

export const GET = authenticatedArtifactRoute as unknown as (
  request: Request,
  context: ArtifactRouteContext,
) => Promise<Response>;
