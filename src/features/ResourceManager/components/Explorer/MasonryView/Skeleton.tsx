import { createStaticStyles, keyframes } from 'antd-style';
import { memo } from 'react';

const pulse = keyframes`
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.6;
  }
`;

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
    animation: ${pulse} 1.5s ease-in-out infinite;
  `,
  /* Matches the real toolbar row (12px padding + 20px content + 0.5px border
     and the 8px gap below it) so loading does not shift the grid. */
  toolbar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    margin-block-end: 8px;
    padding-block: 12px;
    padding-inline: 4px;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
  `,
  grid: css`
    display: grid;
    gap: 16px;
    padding-block: 12px 24px;
    padding-inline: 24px;

    @media (width <= 767px) {
      padding-inline: var(--mobile-page-inner-gutter, var(--mobile-page-gutter, 10px));
    }
  `,
}));

interface MasonrySkeletonProps {
  columnCount: number;
}

const MasonryViewSkeleton = memo<MasonrySkeletonProps>(({ columnCount }) => {
  // Generate varying heights for more natural masonry look
  const heights = [180, 220, 200, 190, 240, 210, 200, 230, 180, 220, 210, 190];

  // Calculate number of items based on viewport and column count, minimum 6 items
  const itemCount = Math.max(Math.min(columnCount * 3, 12), 6);

  // Calculate opacity gradient from 100% to 20%
  const getOpacity = (index: number) => 1 - (index / (itemCount - 1)) * 0.8;

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.card} style={{ height: 20, width: 96 }} />
        <div className={styles.card} style={{ height: 20, width: 120 }} />
      </div>
      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
        }}
      >
      {Array.from({ length: itemCount }).map((_, index) => (
        <div
          className={styles.card}
          key={index}
          style={{
            height: heights[index % heights.length],
            opacity: getOpacity(index),
          }}
        />
        ))}
      </div>
    </>
  );
});

MasonryViewSkeleton.displayName = 'MasonryViewSkeleton';

export default MasonryViewSkeleton;
