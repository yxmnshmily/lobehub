interface CopyResource {
  filename: string;
  fileType: string;
  loadText?: () => Promise<string>;
  url: string;
}

const isImage = ({ fileType, filename }: CopyResource) =>
  fileType.startsWith('image/') || /\.(?:png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(filename);

export const canCopyResourceContent = (resource: CopyResource) =>
  !!resource.loadText ||
  isImage(resource) ||
  resource.fileType.startsWith('text/') ||
  ['application/json', 'application/xml', 'application/javascript'].includes(resource.fileType) ||
  /\.(?:txt|md|markdown|csv|tsv|json|xml|html?|css|[cm]?js|tsx?|jsx|yaml|yml|log)$/i.test(
    resource.filename,
  );

const readContent = async (resource: CopyResource): Promise<Blob> => {
  if (resource.loadText) return new Blob([await resource.loadText()], { type: 'text/plain' });
  if (!resource.url) throw new Error('Missing file URL');
  const response = await fetch(resource.url, { cache: 'no-store', mode: 'cors' });
  if (!response.ok) throw new Error(`Could not load file: ${response.status}`);
  if (!isImage(resource)) return new Blob([await response.text()], { type: 'text/plain' });

  const blob = await response.blob();
  if (blob.type === 'image/png') return blob;
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = objectUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion unavailable');
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error('Image conversion failed'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const copyResourceContent = async (resource: CopyResource) => {
  if (!canCopyResourceContent(resource)) throw new Error('Unsupported clipboard file type');
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Content clipboard unavailable');
  }
  const type = !resource.loadText && isImage(resource) ? 'image/png' : 'text/plain';
  // Start clipboard access within the click gesture, before fetching/decoding completes.
  await navigator.clipboard.write([new ClipboardItem({ [type]: readContent(resource) })]);
};
