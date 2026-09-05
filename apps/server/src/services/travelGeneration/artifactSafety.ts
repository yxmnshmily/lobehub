const ARTIFACT_ID_PATTERN = /^\w[\w-]{0,127}$/;
const CONTROLLED_ARTIFACT_PREFIXES = ['/f/', '/lobehub/'] as const;

export const isSafeArtifactIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && ARTIFACT_ID_PATTERN.test(value);

export const normalizeControlledArtifactUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return undefined;
  }
  if (
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return character === '\\' || codePoint <= 32 || codePoint === 127;
    })
  ) {
    return undefined;
  }

  try {
    const parsed = new URL(value, 'http://travel-generation.internal');
    if (!CONTROLLED_ARTIFACT_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) {
      return undefined;
    }
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (
      [...decodedPath].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return character === '\\' || codePoint <= 32 || codePoint === 127;
      })
    ) {
      return undefined;
    }
    const decodedSegments = decodedPath.split('/');
    if (decodedSegments.some((segment) => segment === '.' || segment === '..')) return undefined;
    return parsed.pathname;
  } catch {
    return undefined;
  }
};
