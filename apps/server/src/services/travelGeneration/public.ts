import { isSafeArtifactIdentifier, normalizeControlledArtifactUrl } from './artifactSafety';
import {
  TRAVEL_ARTIFACT_PERSISTENCE_PUBLIC_MESSAGE,
  type TravelGenerationArtifact,
  type TravelGenerationRecord,
} from './index';

interface PublicTravelGenerationArtifact {
  content?: string;
  documentId?: string;
  id?: string;
  mimeType?: string;
  name?: string;
  type: 'text' | 'document' | 'image';
  url?: string;
}

const projectArtifact = (
  task: TravelGenerationRecord,
  artifact: TravelGenerationArtifact,
): PublicTravelGenerationArtifact[] => {
  if (task.type === 'copy') {
    return artifact.type === 'text' && typeof artifact.content === 'string'
      ? [{ content: artifact.content, type: 'text' }]
      : [];
  }

  if (task.type === 'document') {
    const id = artifact.documentId;
    return artifact.type === 'document' && isSafeArtifactIdentifier(id)
      ? [
          {
            documentId: id,
            id,
            type: 'document',
            url: `/lobehub/page/${encodeURIComponent(id)}`,
          },
        ]
      : [];
  }

  if (task.type === 'image') {
    const id = artifact.generationId;
    const internalUrl = normalizeControlledArtifactUrl(artifact.url);
    if (artifact.type !== 'image' || !isSafeArtifactIdentifier(id) || !internalUrl) return [];
    return [
      {
        id,
        type: 'image',
        url: `/api/travel-generation/artifacts/${encodeURIComponent(task.id)}/${encodeURIComponent(id)}${
          task.owner.workspaceId ? `?workspaceId=${encodeURIComponent(task.owner.workspaceId)}` : ''
        }`,
      },
    ];
  }

  // Video stays unpublished until its provider path has authoritative usage settlement.
  return [];
};

/** Customer-facing task projection. Internal owner, prompt, provider and task links stay server-side. */
export const toPublicTravelGenerationTask = (task: TravelGenerationRecord) => {
  const candidates =
    task.status === 'succeeded'
      ? (task.artifacts ?? []).flatMap((artifact) => projectArtifact(task, artifact))
      : [];

  return {
    artifacts: candidates,
    code: task.code,
    id: task.id,
    ...(task.code === 'ARTIFACT_PERSISTENCE_FAILED'
      ? { message: TRAVEL_ARTIFACT_PERSISTENCE_PUBLIC_MESSAGE }
      : {}),
    status: task.status,
    type: task.type,
  };
};
