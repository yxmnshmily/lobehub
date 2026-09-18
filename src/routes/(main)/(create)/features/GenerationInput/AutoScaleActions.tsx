'use client';

import { memo, type ReactNode, useLayoutEffect, useRef, useState } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';

/**
 * 手机端自适应缩放容器（仅 ≤767px 视口启用）：
 * - 内容自然宽度放得下 → 不缩（zoom 1）
 * - 放不下 → 按比例整体缩小，"能放下的最大尺寸"
 * - zoom 线性，用"当前 zoom × (可用宽/实测宽)"一次乘法校正即可收敛，
 *   最低 0.35 保底可点；ResizeObserver + resize 监听窗口变化。
 * 网页端不做任何缩放，原样渲染。zoom 走内联样式——本环境必定生效。
 */
const AutoScaleActions = memo<{ children: ReactNode }>(({ children }) => {
  const isMobile = useIsMobile();
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const [zoom, setZoom] = useState(1);

  useLayoutEffect(() => {
    if (!isMobile) return;
    const measure = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!outer || !inner) return;
      const avail = outer.clientWidth;
      const visual = inner.getBoundingClientRect().width;
      if (!avail || !visual) return;
      const current = zoomRef.current || 1;
      const next = Math.min(1, Math.max(0.35, current * (avail / visual)));
      zoomRef.current = next;
      setZoom(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (outerRef.current) observer.observe(outerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isMobile]);

  if (!isMobile) return <>{children}</>;

  return (
    <div ref={outerRef} style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
      <div
        ref={innerRef}
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: 4,
          width: 'max-content',
          zoom,
        }}
      >
        {children}
      </div>
    </div>
  );
});

AutoScaleActions.displayName = 'AutoScaleActions';

export default AutoScaleActions;
