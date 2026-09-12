const EXPIRING_QUERY_PARAM_PREFIX = 'x-amz-';
const OBJECT_STORAGE_AUX_PARAM = 'x-id';

/**
 * Object storage uploads (RustFS / S3) hand back pre-signed URLs whose signature
 * lapses after a short window (\`X-Amz-Expires\`, e.g. 2 hours). Persisting such a
 * URL as a profile asset — avatar or banner — makes the image break the moment
 * the signature expires, with no data change on our side.
 *
 * Strip the signature so the stored value is the stable object URL. Callers keep
 * null/undefined semantics so response shapes do not change.
 */
export const toStableAssetUrl = (url?: null | string): null | string | undefined => {
  if (!url) return url;

  try {
    const parsed = new URL(url);
    const searchParams = [...parsed.searchParams.keys()];
    const hasExpiringSignature = searchParams.some((key) =>
      key.toLowerCase().startsWith(EXPIRING_QUERY_PARAM_PREFIX),
    );

    if (!hasExpiringSignature) return url;

    for (const key of searchParams) {
      const normalized = key.toLowerCase();
      if (
        normalized.startsWith(EXPIRING_QUERY_PARAM_PREFIX) ||
        normalized === OBJECT_STORAGE_AUX_PARAM
      ) {
        parsed.searchParams.delete(key);
      }
    }

    return parsed.toString();
  } catch {
    // Not an absolute URL (for example an emoji or a relative path) — leave as-is.
    return url;
  }
};
