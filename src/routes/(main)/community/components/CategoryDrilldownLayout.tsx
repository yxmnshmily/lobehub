'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronLeft } from 'lucide-react';
import { type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

const styles = createStaticStyles(({ css }) => ({
  backBar: css`
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;

    min-height: 44px;
    padding-block: 8px 4px;
    padding-inline: 8px;

    /* 不加底部分隔线：上方头部容器已有一条分隔线，再画一条就成了双线。 */
  `,
  categoryList: css`
    overflow-y: auto;

    /* 注意：不要水平居中（max-width + margin auto）——外层 WideScreenContainer
       带 minWidth(1200px)，窄屏下居中会把列表推到视口外，看起来一片空白。 */
    width: 100%;
    padding: 8px;
  `,
}));

interface CategoryDrilldownLayoutProps {
  /** 三级分类列表（发现/全部/学术…） */
  category: ReactNode;
  /** 选中分类后的内容（列表/网格） */
  children: ReactNode;
}

/**
 * 三级分类的"下钻"布局：先整屏显示分类列表 → 点击任一分类进入内容
 * （整屏 + 顶部返回按钮）→ 返回回到分类列表。
 *
 * 层级状态由 URL 驱动（category/sort 参数存在 = 内容层）：不能用组件 state，
 * 因为点击分类会改变 search params，路由元素重挂载会把 state 重置回分类层，
 * 表现为"点击分类后停留在原地"。
 */
const CategoryDrilldownLayout = ({ category, children }: CategoryDrilldownLayoutProps) => {
  const [searchParams, setSearchParams] = useSearchParams();

  const entered = searchParams.has('category') || searchParams.has('sort');

  const goBack = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('category');
    next.delete('sort');
    setSearchParams(next, { replace: true });
  };

  return (
    <Flexbox gap={0} width={'100%'}>
      {!entered && (
        <Flexbox style={{ flex: 1, minHeight: 0 }}>
          <div className={styles.categoryList}>{category}</div>
        </Flexbox>
      )}

      {entered && (
        <Flexbox gap={0} width={'100%'}>
          <div className={styles.backBar}>
            <Button icon={ChevronLeft} onClick={goBack}>
              返回
            </Button>
          </div>
          <Flexbox flex={1} gap={16} style={{ minHeight: 0 }}>
            {children}
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
};

CategoryDrilldownLayout.displayName = 'CategoryDrilldownLayout';

export default CategoryDrilldownLayout;
