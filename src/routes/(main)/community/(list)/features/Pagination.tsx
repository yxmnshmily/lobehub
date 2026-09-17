'use client';

import { Pagination as Page } from 'antd';
import { createStaticStyles, useResponsive } from 'antd-style';
import { cloneElement, isValidElement, memo, type ReactElement } from 'react';
import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useQuery } from '@/hooks/useQuery';
import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';
import { type DiscoverTab } from '@/types/discover';

const SCROLL_CONTAINER_ID = 'lobe-mobile-scroll-container';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    page: css`
      .${prefixCls}-pagination-item-active {
        border-color: ${cssVar.colorFillSecondary};
        background: ${cssVar.colorFillSecondary};

        &:hover {
          border-color: ${cssVar.colorFill};
          background: ${cssVar.colorFill};
        }
      }
    `,
  };
});

interface PaginationProps {
  currentPage: number;
  pageSize: number;
  tab: DiscoverTab;
  total: number;
}

const Pagination = memo<PaginationProps>(({ tab, currentPage, total, pageSize }) => {
  const { page } = useQuery();
  const navigate = useWorkspaceAwareNavigate();
  const location = useLocation();
  const { mobile } = useResponsive();

  const handlePageChange = (newPage: number) => {
    const searchParams = new URLSearchParams(location.search);
    searchParams.set('page', String(newPage));
    navigate(`/community/${tab}?${searchParams.toString()}`);

    const scrollContainerId = mobile ? SCROLL_CONTAINER_ID : SCROLL_PARENT_ID;
    const scrollableElement = document?.querySelector(`#${scrollContainerId}`);
    if (!scrollableElement) return;
    scrollableElement.scrollTo({ behavior: 'smooth', top: 0 });
  };

  return (
    <Page
      className={styles.page}
      current={page ? Number(page) : currentPage}
      data-testid="pagination"
      showSizeChanger={false}
      total={total}
      itemRender={(_, type, element) =>
        (type === 'prev' || type === 'next') && isValidElement(element)
          ? cloneElement(element as ReactElement<{ 'aria-label'?: string }>, {
              'aria-label': type === 'prev' ? 'previous' : 'next',
            })
          : element
      }
      style={{
        alignSelf: 'flex-end',
      }}
      onChange={handlePageChange}
      pageSize={pageSize}
      /* 窄屏用 simple 模式（‹ 1/25 ›）：完整数字页码在 440px 下放不下，
         "最后一页"会被挤到第二行。 */
      simple={mobile}
    />
  );
});

export default Pagination;
