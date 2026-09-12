'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import CustomerCenter, {
  type CustomerCenterCopy,
  type CustomerCenterPaginationControl,
  type CustomerCenterSectionKey,
  type CustomerGenerationFilters,
} from '@/features/CustomerCenter';
import { lambdaQuery } from '@/libs/trpc/client';
import { translateTravel, useTravelTranslation } from '@/utils/i18n/travel';

import {
  buildCustomerCenterData,
  buildCustomerCenterPageData,
  buildCustomerGenerationDetail,
  buildCustomerGenerationFilterInput,
  resolveCustomerGenerationDetailId,
} from './customerCenterAdapter';

const PAGE_SIZE = 20;

const useCursorPager = () => {
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);

  const goBack = useCallback(() => {
    if (history.length === 0) return;
    setCursor(history.at(-1));
    setHistory((current) => current.slice(0, -1));
  }, [history]);

  const goForward = useCallback(
    (nextCursor?: null | string) => {
      if (!nextCursor) return;
      setHistory((current) => [...current, cursor]);
      setCursor(nextCursor);
    },
    [cursor],
  );

  const reset = useCallback(() => {
    setCursor(undefined);
    setHistory([]);
  }, []);

  return { canGoBack: history.length > 0, cursor, goBack, goForward, reset };
};

const copy: CustomerCenterCopy = {
  get accountSecurityTitle() {
    return translateTravel('登录安全');
  },
  get balancesTitle() {
    return translateTravel('积分余额');
  },
  get balanceUnavailable() {
    return translateTravel('积分余额暂时无法读取');
  },
  creationStatus: {
    get failed() {
      return translateTravel('失败');
    },
    get processing() {
      return translateTravel('制作中');
    },
    get succeeded() {
      return translateTravel('已完成');
    },
    get unavailable() {
      return translateTravel('当前不可用');
    },
    get unknown() {
      return translateTravel('状态未知');
    },
  },
  get creationsUnavailable() {
    return translateTravel('生成记录暂时无法读取');
  },
  get creditBalanceLabel() {
    return translateTravel('可用积分');
  },
  get creditsChangeLabel() {
    return translateTravel('积分变动');
  },
  get defaultRechargeSource() {
    return translateTravel('余额变动');
  },
  get generationTasksEmpty() {
    return translateTravel('暂无生成任务');
  },
  get generationTasksTitle() {
    return translateTravel('生成任务');
  },
  get generationSettlementPending() {
    return translateTravel('结算完成后可查看成果');
  },
  get generationUnavailableVideo() {
    return translateTravel('视频生成功能当前不可用，未产生任何视频作品');
  },
  get inputTokensLabel() {
    return translateTravel('输入');
  },
  get outputTokensLabel() {
    return translateTravel('输出');
  },
  get ordersEmpty() {
    return translateTravel('暂无服务订单');
  },
  orderStatus: {
    get cancelled() {
      return translateTravel('已取消');
    },
    get completed() {
      return translateTravel('已完成');
    },
    get pending() {
      return translateTravel('待处理');
    },
    get refunded() {
      return translateTravel('已退款');
    },
  },
  get ordersTitle() {
    return translateTravel('服务订单');
  },
  get pageNextLabel() {
    return translateTravel('下一页');
  },
  get pagePreviousLabel() {
    return translateTravel('上一页');
  },
  get rechargeEmpty() {
    return translateTravel('暂无充值或余额变动记录');
  },
  get rechargeTitle() {
    return translateTravel('积分充值与变动');
  },
  sections: {
    get 'account-security'() {
      return translateTravel('账号与安全');
    },
    get 'balance-usage'() {
      return translateTravel('账户用量');
    },
    get 'my-creations'() {
      return translateTravel('我的生成');
    },
    get 'plans'() {
      return translateTravel('费用套餐');
    },
    get 'recharge-history'() {
      return translateTravel('积分明细');
    },
  },
  get sessionSecurityNotice() {
    return translateTravel('修改或重置密码后，其他设备上的登录会话会自动退出。');
  },
  get title() {
    return translateTravel('个人中心');
  },
  get totalTokensLabel() {
    return translateTravel('合计');
  },
  get usageEmpty() {
    return translateTravel('暂无可用的模型用量记录');
  },
  get worksEmpty() {
    return translateTravel('暂无作品或文稿');
  },
  get worksTitle() {
    return translateTravel('作品与文稿');
  },
};

const CustomerCenterPage = ({
  defaultSection = 'account-security',
}: {
  defaultSection?: CustomerCenterSectionKey;
}) => {
  const translateTravel = useTravelTranslation();
  const { i18n } = useTranslation();
  const ledgerPager = useCursorPager();
  const orderPager = useCursorPager();
  const generationPager = useCursorPager();
  const workPager = useCursorPager();
  const [generationFilters, setGenerationFilters] = useState<CustomerGenerationFilters>({});
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedGenerationId = resolveCustomerGenerationDetailId(searchParams.get('generationId'));
  const filterInput = useMemo(
    () => buildCustomerGenerationFilterInput(generationFilters),
    [generationFilters],
  );
  const overview = lambdaQuery.customerCenter.getOverview.useQuery({
    ledgerLimit: 1,
    recentLimit: 1,
  });
  const ledgerPage = lambdaQuery.customerCenter.getPage.useQuery({
    cursor: ledgerPager.cursor,
    kind: 'ledger',
    limit: PAGE_SIZE,
  });
  const orderPage = lambdaQuery.customerCenter.getPage.useQuery({
    cursor: orderPager.cursor,
    kind: 'order',
    limit: PAGE_SIZE,
  });
  const generationPage = lambdaQuery.customerCenter.getPage.useQuery({
    cursor: generationPager.cursor,
    ...filterInput,
    kind: 'generation',
    limit: PAGE_SIZE,
  });
  const workPage = lambdaQuery.customerCenter.getPage.useQuery({
    cursor: workPager.cursor,
    ...filterInput,
    kind: 'work',
    limit: PAGE_SIZE,
  });
  const generationDetailQuery = lambdaQuery.customerCenter.getGenerationDetail.useQuery(
    { id: selectedGenerationId || '' },
    { enabled: Boolean(selectedGenerationId) },
  );
  const data = useMemo(() => {
    const overviewData = buildCustomerCenterData(overview.data, {
      error: overview.error ? translateTravel('个人中心数据暂时无法读取，请稍后重试') : undefined,
      isLoading: overview.isLoading,
    });
    const pageData = buildCustomerCenterPageData(
      {
        generation:
          generationPage.data?.kind === 'generation' ? (generationPage.data as never) : undefined,
        ledger: ledgerPage.data?.kind === 'ledger' ? (ledgerPage.data as never) : undefined,
        order: orderPage.data?.kind === 'order' ? (orderPage.data as never) : undefined,
        work: workPage.data?.kind === 'work' ? (workPage.data as never) : undefined,
      },
      {
        generation: {
          error: generationPage.error ? translateTravel('生成任务暂时无法读取') : undefined,
          isLoading: generationPage.isLoading,
        },
        ledger: {
          error: ledgerPage.error ? translateTravel('充值与余额记录暂时无法读取') : undefined,
          isLoading: ledgerPage.isLoading,
        },
        order: {
          error: orderPage.error ? translateTravel('服务订单暂时无法读取') : undefined,
          isLoading: orderPage.isLoading,
        },
        work: {
          error: workPage.error ? translateTravel('作品与文稿暂时无法读取') : undefined,
          isLoading: workPage.isLoading,
        },
      },
    );

    return { ...overviewData, ...pageData };
  }, [
    translateTravel,
    generationPage.data,
    generationPage.error,
    generationPage.isLoading,
    ledgerPage.data,
    ledgerPage.error,
    ledgerPage.isLoading,
    overview.data,
    overview.error,
    overview.isLoading,
    orderPage.data,
    orderPage.error,
    orderPage.isLoading,
    workPage.data,
    workPage.error,
    workPage.isLoading,
  ]);

  const generationDetail = useMemo(
    () =>
      selectedGenerationId
        ? buildCustomerGenerationDetail(generationDetailQuery.data, {
            error: generationDetailQuery.error
              ? translateTravel('生成详情暂时无法读取')
              : undefined,
            isLoading: generationDetailQuery.isLoading,
          })
        : undefined,
    [
      translateTravel,
      generationDetailQuery.data,
      generationDetailQuery.error,
      generationDetailQuery.isLoading,
      selectedGenerationId,
    ],
  );

  const setSelectedGenerationId = useCallback(
    (id?: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          const safeId = resolveCustomerGenerationDetailId(id || null);
          if (safeId) next.set('generationId', safeId);
          else next.delete('generationId');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleGenerationFiltersChange = useCallback(
    (filters: CustomerGenerationFilters) => {
      setGenerationFilters(filters);
      setSelectedGenerationId(undefined);
      generationPager.reset();
      workPager.reset();
    },
    [generationPager, setSelectedGenerationId, workPager],
  );

  const makePagination = (
    pager: ReturnType<typeof useCursorPager>,
    nextCursor: null | string | undefined,
    isLoading: boolean,
  ): CustomerCenterPaginationControl => ({
    canGoBack: pager.canGoBack,
    canGoForward: Boolean(nextCursor),
    isLoading,
    onBack: pager.goBack,
    onForward: () => pager.goForward(nextCursor),
  });

  return (
    <CustomerCenter
      copy={copy}
      data={data}
      defaultSection={defaultSection}
      generationDetail={generationDetail}
      generationFilters={generationFilters}
      locale={i18n.resolvedLanguage || i18n.language || 'zh-CN'}
      pagination={{
        generationTasks: makePagination(
          generationPager,
          generationPage.data?.nextCursor,
          generationPage.isFetching,
        ),
        orders: makePagination(orderPager, orderPage.data?.nextCursor, orderPage.isFetching),
        recharges: makePagination(ledgerPager, ledgerPage.data?.nextCursor, ledgerPage.isFetching),
        works: makePagination(workPager, workPage.data?.nextCursor, workPage.isFetching),
      }}
      onCloseGenerationDetail={() => setSelectedGenerationId(undefined)}
      onGenerationFiltersChange={handleGenerationFiltersChange}
      onOpenGenerationDetail={setSelectedGenerationId}
      onRetryGenerationDetail={() => void generationDetailQuery.refetch()}
      onRetryOrders={() => void orderPage.refetch()}
      onRetryOverview={() => void overview.refetch()}
      onRetryRecharges={() => void ledgerPage.refetch()}
      onRefresh={() => {
        void overview.refetch();
        void ledgerPage.refetch();
        void orderPage.refetch();
        void generationPage.refetch();
        void workPage.refetch();
        if (selectedGenerationId) void generationDetailQuery.refetch();
      }}
      onRetryCreations={() => {
        void generationPage.refetch();
        void workPage.refetch();
      }}
    />
  );
};

export default CustomerCenterPage;
