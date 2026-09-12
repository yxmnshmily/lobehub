import type { FileService } from '@/server/services/file';

const isLocalHost = (hostname: string) =>
  /^(?:localhost|127\.[\d.]+|\[::1\]|10\.[\d.]+|192\.168\.[\d.]+|172\.(?:1[6-9]|2\d|3[01])\.[\d.]+)$/.test(
    hostname,
  );

export const resolveLocalReference = async (
  files: Pick<FileService, 'getFullFileUrl' | 'getFileMetadata' | 'getFileByteArray'>,
  key: string,
  source?: string,
): Promise<string> => {
  if (source && /^https?:\/\//.test(source)) {
    const original = new URL(source);
    if (!isLocalHost(original.hostname) && !/\/(?:lobehub\/)?f\//.test(original.pathname))
      return source;
  }
  const url = await files.getFullFileUrl(key);
  if (!url) return url;
  const hostname = new URL(url).hostname;
  if (!isLocalHost(hostname)) return url;
  const { contentType, contentLength } = await files.getFileMetadata(key);
  if (
    !contentType ||
    !/^image\/(?:png|jpeg|webp)$/.test(contentType) ||
    contentLength > 10 * 1024 * 1024
  )
    throw new Error('Reference image must be PNG, JPEG or WebP and at most 10 MB');
  const bytes = await files.getFileByteArray(key);
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Reference image exceeds 10 MB');
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
};
