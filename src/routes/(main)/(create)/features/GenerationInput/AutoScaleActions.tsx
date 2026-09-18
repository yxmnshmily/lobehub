'use client';

import { memo, type ReactNode, useLayoutEffect, useRef, useState } from 'react';

/**
 * 自适应缩放容器（两端生效，网页端 + 手机端）：
 * - 左操作槽位有富余 → 整批放大（上限 1.35，和右侧发送按钮体量匹配）
 * - 放不下 → 按比例整体缩小，"能放下的最大尺寸"（下限 0.35 保底可点）
 * - zoom 线性，用"当前 zoom × (可用宽/实测宽)"一次乘法校正即可收敛；
 *   ResizeObserver + resize 监听窗口/转屏变化。
 * zoom 走内联样式——本环境必定生效。
 */
const AutoScaleActions = memo<{ children: ReactNode }>(({ children }) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const [zoom, setZoom] = useState(1);

  useLayoutEffect(() => {
    const measure = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!outer || !inner) return;
      const avail = outer.clientWidth;
      const visual = inner.getBoundingClientRect().width;
      if (!avail || !visual) return;
      const current = zoomRef.current || 1;
      const next = Math.min(1.35, Math.max(0.35, current * (avail / visual)));
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
  }, []);

  return (
    <div
      data-auto-scale-outer=""
      ref={outerRef}
      style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}
    >
      <div
        data-auto-scale-inner=""
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
