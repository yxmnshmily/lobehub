import { memo, useEffect, useRef, useState } from 'react';

interface TruncatedFileNameProps {
  className?: string;
  name: string;
}

/**
 * 文字宽度测量：用 canvas，不做 DOM 插入、不读 offsetWidth。
 *
 * 旧实现每行都 createElement('span') → append 到 body → 反复读 offsetWidth，
 * 每次读 offsetWidth 都会强制同步重排；虚拟列表滚动时每挂载一行就重排好几次，
 * 滚动必然卡顿。canvas.measureText 不触发重排，并且按「字体+文本」缓存。
 */
let measureCtx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

const measureTextWidth = (text: string, font: string): number => {
  const key = `${font}\u0000${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 8;
  measureCtx.font = font;
  const width = measureCtx.measureText(text).width;
  if (widthCache.size > 5000) widthCache.clear();
  widthCache.set(key, width);
  return width;
};

/**
 * Truncates file name from the center, preserving the extension at the end
 * Similar to macOS Finder behavior
 */
const TruncatedFileName = memo<TruncatedFileNameProps>(({ name, className }) => {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [displayName, setDisplayName] = useState(name);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateTruncation = () => {
      const containerWidth = container.offsetWidth;
      if (containerWidth === 0) return;

      const font = window.getComputedStyle(container).font;

      // If it fits, show the full name
      if (measureTextWidth(name, font) <= containerWidth) {
        setDisplayName(name);
        return;
      }

      // Split filename and extension
      const lastDotIndex = name.lastIndexOf('.');
      let baseName = name;
      let extension = '';

      // Only treat as extension if dot is not at the start and there's content after it
      if (lastDotIndex > 0 && lastDotIndex < name.length - 1) {
        baseName = name.slice(0, lastDotIndex);
        extension = name.slice(lastDotIndex); // includes the dot
      }

      const ellipsisWidth = measureTextWidth('...', font);
      const extensionWidth = measureTextWidth(extension, font);

      // Calculate available width for base name
      const availableWidth = containerWidth - ellipsisWidth - extensionWidth;

      if (availableWidth <= 0) {
        // Not enough space, just show ellipsis + extension
        setDisplayName(`...${extension}`);
        return;
      }

      // Binary search to find the optimal split point
      let left = 0;
      let right = baseName.length;
      let bestFit = '';

      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const startChars = Math.ceil(mid / 2);
        const endChars = Math.floor(mid / 2);

        const truncated =
          baseName.slice(0, startChars) + (mid > 0 ? baseName.slice(-endChars) : '');

        if (measureTextWidth(truncated, font) <= availableWidth) {
          bestFit = truncated;
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      }

      // Construct final truncated name
      if (bestFit.length === 0) {
        setDisplayName(`...${extension}`);
      } else {
        const startChars = Math.ceil(bestFit.length / 2);
        const endChars = Math.floor(bestFit.length / 2);
        setDisplayName(
          `${baseName.slice(0, startChars)}...${baseName.slice(-endChars)}${extension}`,
        );
      }
    };

    updateTruncation();

    // Use ResizeObserver to handle container size changes
    const resizeObserver = new ResizeObserver(updateTruncation);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [name]);

  return (
    <span className={className} ref={containerRef} title={name}>
      {displayName}
    </span>
  );
});

TruncatedFileName.displayName = 'TruncatedFileName';

export default TruncatedFileName;
