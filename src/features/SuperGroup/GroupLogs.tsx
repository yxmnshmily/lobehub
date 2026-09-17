'use client';

import { formatLocalizedTokens } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Tag, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import {
  ChartNoAxesColumn,
  CircleCheck,
  CirclePlay,
  CircleX,
  Download,
  Logs,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMonthlyExchangeRate } from '@/features/CustomerCenter/useMonthlyExchangeRate';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';

const categories = [
  ['all', '全部日志', Logs],
  ['running', '执行中', CirclePlay],
  ['success', '成功日志', CircleCheck],
  ['failed', '失败／中断', CircleX],
  ['error', '异常日志', TriangleAlert],
  ['usage', '消耗统计', ChartNoAxesColumn],
] as const;
type Category = (typeof categories)[number][0];
const statusNames: Record<string, string> = {
  idle: '待执行',
  running: '执行中',
  done: '执行完成',
  error: '执行失败',
  interrupted: '已中断',
  abandoned: '已终止',
  waiting_for_human: '等待人工处理',
  waiting_for_async_tool: '等待工具结果',
};
const reasons: Record<string, string> = {
  cost_limit: '达到费用上限',
  max_steps: '达到执行步数上限',
  lease_expired: '执行连接过期',
  interrupted: '执行被中断',
  done: '本次执行结束',
  error: '执行异常',
};
const errors: Record<string, string> = {
  rate_limit: '请求频率受限，请稍后重试',
  authentication: '模型服务认证失败，请管理员检查配置',
  timeout: '模型服务响应超时',
  unavailable: '模型服务暂时不可用',
  execution_error: '执行发生异常，详细原因未提供或已隐藏敏感信息',
};

export default function GroupLogs({
  groupId,
  onNavigate,
}: {
  groupId: string;
  onNavigate?: () => void;
}) {
  const [page, setPage] = useState<{ offset: number; category: Category }>({
    offset: 0,
    category: 'all',
  });
  const { i18n } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const { money } = useMonthlyExchangeRate();
  const router = useQueryRoute();
  const query = lambdaQuery.groupConversation.listTasks.useQuery(
    { groupId, ...page },
    { refetchInterval: 10_000, retry: false },
  );
  const rows = query.data?.items ?? [];
  const costs: Record<string, number> = {};
  let measuredCosts = 0;
  let measuredTokens = 0;
  let totalTokens = 0;
  for (const row of rows) {
    if (row.totalCost != null) {
      costs[row.currency] = (costs[row.currency] ?? 0) + row.totalCost;
      measuredCosts++;
    }
    if (row.totalTokens != null) {
      totalTokens += row.totalTokens;
      measuredTokens++;
    }
  }
  const count = (value: number | null) =>
    value == null ? '未记录' : formatLocalizedTokens(value, i18n.language);
  const time = (value: Date | null) =>
    value ? new Date(value).toLocaleString(i18n.language) : '未记录';
  const exportLogs = async () => {
    setExporting(true);
    setExportError(false);
    try {
      const items = new Map<string, (typeof rows)[number]>();
      let offset: number | null = 0;
      do {
        const result = await lambdaClient.groupConversation.listTasks.query({
          groupId,
          category: page.category,
          offset,
        });
        for (const item of result.items) items.set(item.id, item);
        offset = result.nextOffset;
      } while (offset != null);
      const blob = new Blob(
        [
          JSON.stringify(
            {
              exportedAt: new Date().toISOString(),
              range: '最近30天',
              category: page.category,
              note: '运行费用保留原始币种，不是积分扣费账单；null表示未记录。',
              items: [...items.values()],
            },
            null,
            2,
          ),
        ],
        { type: 'application/json;charset=utf-8' },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `群日志-30天-${page.category}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };
  return (
    <Flexbox gap={16} style={{ minWidth: 0, maxHeight: '72dvh', overflowY: 'auto' }}>
      <Flexbox horizontal gap={8} wrap="wrap">
        {categories.map(([key, label, icon]) => (
          <Button
            aria-pressed={page.category === key}
            disabled={exporting}
            icon={icon}
            key={key}
            type={page.category === key ? 'primary' : 'default'}
            onClick={() => setPage({ category: key, offset: 0 })}
          >
            {label}
          </Button>
        ))}
        <Button disabled={query.isFetching} icon={RefreshCw} onClick={() => void query.refetch()}>
          刷新
        </Button>
        <Button
          disabled={exporting || query.isLoading || query.isError || !rows.length}
          icon={Download}
          onClick={() => void exportLogs()}
        >
          {exporting ? '正在导出…' : '导出 JSON'}
        </Button>
      </Flexbox>
      <Text type="secondary">
        仅显示最近 30 天的群 AI
        执行日志；导出包含当前分类的所有分页。异常与失败可能重叠；执行完成不代表交付已验收。每 10
        秒刷新。
      </Text>
      {exportError && <Alert title="导出失败，请重试；未生成不完整文件。" type="error" />}
      {query.isError ? (
        <Alert
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
          title="群日志加载失败"
          type="error"
        />
      ) : query.isLoading ? (
        <Text>正在加载群日志…</Text>
      ) : (
        <>
          <Flexbox
            gap={6}
            padding={12}
            style={{ background: cssVar.colorFillTertiary, borderRadius: 8 }}
          >
            <Text weight={600}>本页统计 · {rows.length} 条记录</Text>
            <Text>
              Token：{measuredTokens ? count(totalTokens) : '未记录'} · 运行费用参考：
              {measuredCosts
                ? Object.entries(costs)
                    .map(([currency, amount]) => money(amount, currency, 6))
                    .join(' + ')
                : '未记录'}
            </Text>
            <Text type="secondary">
              费用已计量 {measuredCosts}/{rows.length} 条，Token 已计量 {measuredTokens}/
              {rows.length} 条。未记录不代表零消耗；运行费用不是充值账单或积分扣费明细。
            </Text>
          </Flexbox>
          {!rows.length && <Text>当前筛选下暂无日志</Text>}
          {rows.map((row) => (
            <Flexbox
              gap={8}
              key={row.id}
              padding={12}
              style={{
                border: `0.5px solid ${cssVar.colorBorderSecondary}`,
                borderRadius: 8,
                minWidth: 0,
              }}
            >
              <Flexbox horizontal gap={8} justify="space-between" wrap="wrap">
                <Text weight={600}>{row.agentName || '群 AI'}</Text>
                <Tag>{statusNames[row.status] ?? '状态未知'}</Tag>
              </Flexbox>
              <Text>
                {row.topicTitle || '话题未记录'} · {time(row.createdAt)}
              </Text>
              <Text style={{ overflowWrap: 'anywhere' }} type="secondary">
                {row.model || '模型未记录'}
                {row.provider ? ` · ${row.provider}` : ''}
              </Text>
              <Flexbox horizontal gap={16} wrap="wrap">
                <Text>Token {count(row.totalTokens)}</Text>
                <Text>
                  费用 {row.totalCost == null ? '未记录' : money(row.totalCost, row.currency, 6)}
                </Text>
                <Text>
                  执行耗时{' '}
                  {row.processingTimeMs == null
                    ? '未记录'
                    : `${(row.processingTimeMs / 1000).toFixed(1)} 秒`}
                </Text>
              </Flexbox>
              {row.errorCode && (
                <Alert title={errors[row.errorCode] || errors.execution_error} type="error" />
              )}
              {row.completionReason && (
                <Text type="secondary">
                  结束原因：
                  {reasons[row.completionReason] || statusNames[row.completionReason] || '未记录'}
                </Text>
              )}
              <details>
                <summary style={{ cursor: 'pointer' }}>执行明细</summary>
                <Flexbox gap={4} paddingBlock={8}>
                  <Text>
                    开始：{time(row.startedAt)} · 结束：{time(row.completedAt)}
                  </Text>
                  <Text>
                    输入 Token {count(row.totalInputTokens)} · 输出 Token{' '}
                    {count(row.totalOutputTokens)}
                  </Text>
                  <Text>
                    执行步数 {count(row.stepCount)} · 模型调用 {count(row.llmCalls)} 次 · 工具调用{' '}
                    {count(row.toolCalls)} 次
                  </Text>
                  <Text style={{ overflowWrap: 'anywhere' }} type="secondary">
                    日志编号：{row.id}
                  </Text>
                </Flexbox>
              </details>
              {row.topicId && (
                <Button
                  onClick={() => {
                    router.push(`/group/${groupId}/${row.topicId}`, {
                      replace: true,
                    });
                    onNavigate?.();
                  }}
                >
                  查看话题
                </Button>
              )}
            </Flexbox>
          ))}
        </>
      )}
      {(page.offset > 0 || query.data?.nextOffset != null) && (
        <Flexbox horizontal gap={8}>
          <Button
            disabled={!page.offset || query.isFetching}
            onClick={() => setPage({ ...page, offset: Math.max(0, page.offset - 50) })}
          >
            上一页
          </Button>
          <Button
            disabled={query.data?.nextOffset == null || query.isFetching}
            onClick={() => setPage({ ...page, offset: query.data?.nextOffset ?? page.offset })}
          >
            下一页
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
}
