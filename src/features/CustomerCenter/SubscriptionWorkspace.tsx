'use client';

import { formatLocalizedTokens } from '@lobechat/utils/format';
import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Modal, Text } from '@lobehub/ui/base-ui';
import { Empty } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  Clock3,
  Coins,
  Cpu,
  FolderOpen,
  Hash,
  History,
  Layers,
  LayoutDashboard,
  List,
  Plus,
  Sparkles,
  UsersRound,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';

import SkeletonText from '@/components/Skeleton/Text';
import { useMonthlyExchangeRate } from '@/features/CustomerCenter/useMonthlyExchangeRate';
import { lambdaQuery } from '@/libs/trpc/client';
import { getTravelLocale, translateTravel, useTravelTranslation } from '@/utils/i18n/travel';

import AvailableTokenEstimate from './AvailableTokenEstimate';
import CreditLedger from './CreditLedger';
import CreditsOrders from './CreditsOrders';
import EnabledModelPricing from './EnabledModelPricing';
import { PaymentMethods } from './PaymentCheckout';
import { summarizeRecordedUsage } from './usageSummary';
import UsageTokenMetric from './UsageTokenMetric';

export type SubscriptionSection = 'plans' | 'usage' | 'credits' | 'billing';
const titles: Record<SubscriptionSection, string> = {
  get plans() {
    return translateTravel('套餐');
  },
  get usage() {
    return translateTravel('账户用量');
  },
  get credits() {
    return translateTravel('积分');
  },
  get billing() {
    return translateTravel('账单');
  },
};
// Monthly offers approved by the site owner. No annual discount or recurring charge is implied.
const plans = [
  {
    get name() {
      return translateTravel('基础版');
    },
    price: 99,
    credits: 10_000_000,
    get description() {
      return translateTravel('适合偶尔使用 AI 的用户');
    },
    icon: Sparkles,
  },
  {
    get name() {
      return translateTravel('进阶版');
    },
    price: 599,
    credits: 60_000_000,
    get description() {
      return translateTravel('适合频繁使用 AI 的专业用户');
    },
    icon: Zap,
  },
  {
    get name() {
      return translateTravel('专业版');
    },
    price: 999,
    credits: 100_000_000,
    get description() {
      return translateTravel('适合需要复杂 AI 对话的重度用户');
    },
    icon: Coins,
  },
] as const;

const styles = createStaticStyles(({ css, responsive }) => ({
  planSummary: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;

    margin: 0;
    padding-block: 20px;
    border-block: 0.5px solid ${cssVar.colorBorderSecondary};

    dt {
      color: ${cssVar.colorTextSecondary};
    }

    dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      text-align: end;
      overflow-wrap: anywhere;
    }
  `,
  iconLabel: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    svg {
      flex-shrink: 0;
    }
  `,
  usageScroll: css`
    overflow: hidden auto;
    flex: 1;
    min-height: 0;
  `,
  page: css`
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    margin-inline: auto;
    /* Gutter comes from the settings container (48px per side). */

    font-size: 14px;
    line-height: 1.6;
    color: ${cssVar.colorText};

    h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }

    h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }

    p {
      margin-block: 6px;
      margin-inline: 0;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    a:hover {
      color: ${cssVar.colorPrimary};
    }

    button,
    input,
    select {
      font: inherit;
    }
    ${responsive.sm} {
      padding-block: 16px 32px;
      padding-inline: var(--mobile-page-inner-gutter, var(--mobile-page-gutter, 10px));
    }
  `,
  muted: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  period: css`
    display: flex;
    justify-content: center;
    margin-block-end: 24px;

    span {
      padding-block: 7px;
      padding-inline: 42px;
      border: 0.5px solid ${cssVar.colorBorderSecondary};
      border-radius: 10px;

      background: ${cssVar.colorFillQuaternary};
    }
  `,
  plans: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    ${responsive.md} {
      grid-template-columns: 1fr;
    }
  `,
  plan: css`
    padding-block: 20px;
    padding-inline: 16px;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    background: ${cssVar.colorBgContainer};

    > header {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    > header svg {
      flex: none;

      width: 32px;
      height: 32px;
      padding: 6px;
      border-radius: 9px;

      background: ${cssVar.colorFillSecondary};
    }

    button {
      width: 100%;
      margin-block: 16px 20px;
      margin-inline: 0;
    }

    dl {
      margin: 0;
    }

    dt {
      margin-block-start: 16px;
      color: ${cssVar.colorTextSecondary};
    }

    dd {
      margin-block: 4px 0;
      margin-inline: 0;
    }

    > dl {
      display: flex;
      gap: 8px;
      align-items: baseline;

      margin-block-start: 16px;

      white-space: nowrap;

      dt,
      dd {
        margin: 0;
      }
    }

    ul {
      padding: 0;
      list-style: none;
    }

    li {
      display: flex;
      gap: 8px;
      align-items: center;

      padding-block: 5px;
      padding-inline: 0;
    }

    li svg {
      flex: none;
      width: 14px;
      height: 14px;
      color: ${cssVar.colorSuccess};
    }
  `,
  price: css`
    margin-block-start: 28px;
    font-variant-numeric: tabular-nums;

    b {
      font-size: 30px;
      font-weight: 650;
    }
  `,
  section: css`
    margin-block-start: 28px;
  `,
  panel: css`
    overflow: hidden;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorBgContainer};
  `,
  panelTitle: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block: 14px;
    padding-inline: 20px;

    font-weight: 600;

    background: ${cssVar.colorFillQuaternary};
  `,
  metrics: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));

    > div {
      padding: 24px;
    }

    > div:nth-child(n + 3) {
      border-block-start: 0.5px solid ${cssVar.colorBorderSecondary};
    }

    > div:nth-child(odd) {
      border-inline-end: 0.5px solid ${cssVar.colorBorderSecondary};
    }

    strong {
      display: block;
      margin-block-start: 8px;
      font-size: 22px;
      font-variant-numeric: tabular-nums;
    }
    ${responsive.sm} {
      grid-template-columns: 1fr;

      > div:nth-child(odd) {
        border-inline-end: 0;
      }

      > div:nth-child(n + 2) {
        border-block-start: 0.5px solid ${cssVar.colorBorderSecondary};
      }
    }
  `,
  balance: css`
    display: grid;
    grid-template-columns: 1fr 340px;
    gap: 24px;
    padding: 24px;

    strong {
      display: block;
      margin-block: 8px 20px;
      margin-inline: 0;
      font-size: 32px;
    }
    ${responsive.md} {
      grid-template-columns: 1fr;
    }
  `,
  membership: css`
    display: flex;
    flex-direction: column;
    justify-content: space-between;

    min-height: 180px;
    padding: 24px;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorFillQuaternary};

    small {
      letter-spacing: 2px;
    }

    b {
      font-size: 26px;
    }
  `,
  links: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;

    padding-block: 14px;
    padding-inline: 24px;
    border-block-start: 0.5px solid ${cssVar.colorBorderSecondary};

    > a,
    > button {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      justify-content: center;

      box-sizing: border-box;
      min-width: 144px;
      height: 36px;
      padding-inline: 12px;
      border: 0.5px solid ${cssVar.colorBorder};
      border-radius: 8px;

      white-space: nowrap;

      background: ${cssVar.colorBgContainer};

      &:hover {
        background: ${cssVar.colorFillTertiary};
      }

      &:focus-visible {
        outline: 2px solid ${cssVar.colorPrimary};
        outline-offset: 2px;
      }

      svg {
        flex-shrink: 0;
      }
    }
  `,
  toolbar: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    padding-block: 16px;
    padding-inline: 0;

    input,
    select {
      min-width: 0;
      max-width: 100%;
      padding-block: 7px;
      padding-inline: 10px;
      border: 0.5px solid ${cssVar.colorBorder};
      border-radius: 8px;

      color: ${cssVar.colorText};

      color-scheme: light dark;
      background: ${cssVar.colorBgContainer};
    }
  `,
  table: css`
    overflow: auto;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 13px;
      white-space: nowrap;
    }

    th {
      font-weight: 500;
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillQuaternary};
    }

    th,
    td {
      padding-block: 14px;
      padding-inline: 16px;
      border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
      text-align: start;
    }

    tr:last-child td {
      border-block-end: 0;
    }
  `,
  footer: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block-start: 16px;

    > div {
      display: flex;
      flex-shrink: 0;
      gap: 8px;
      margin-inline-start: auto;
    }
  `,
}));

const number = (value?: number | null) =>
  value == null ? '—' : value.toLocaleString(getTravelLocale());
const kindName: Record<string, string> = {
  get chat() {
    return translateTravel('对话');
  },
  get copy() {
    return translateTravel('文案');
  },
  get document() {
    return translateTravel('文稿');
  },
  get image() {
    return translateTravel('图片');
  },
  get video() {
    return translateTravel('视频');
  },
};

const SubscriptionWorkspace = ({ section: requestedSection }: { section: SubscriptionSection }) => {
  // Keep existing billing bookmarks on the shared balance page.
  const section = requestedSection === 'billing' ? 'credits' : requestedSection;
  const { hash } = useLocation();
  useEffect(() => {
    if (section === 'credits' && (hash === '#credit-ledger' || requestedSection === 'billing'))
      document.getElementById('credit-ledger')?.scrollIntoView?.({ block: 'start' });
  }, [hash, requestedSection, section]);
  const translateTravel = useTravelTranslation();
  const { money, isCny } = useMonthlyExchangeRate();
  const [selectedPlan, setSelectedPlan] = useState<(typeof plans)[number]>();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const overview = lambdaQuery.customerCenter.getOverview.useQuery(
    { ledgerLimit: 1, recentLimit: 1 },
    {
      enabled: section === 'usage' || section === 'credits',
      retry: false,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      refetchInterval: 15_000,
    },
  );
  const details = lambdaQuery.customerCenter.getUsageDetails.useQuery(undefined, {
    enabled: section === 'usage',
    retry: false,
  });
  const account = overview.data?.credits?.account;
  const hasAvailableBalance =
    Number.isSafeInteger(account?.availableCredits) && (account?.availableCredits ?? -1) >= 0;
  const usage = overview.data?.usage?.canonicalTotals;
  const completeUsage = [
    usage?.totalTokens,
    usage?.totalInputTokens,
    usage?.totalOutputTokens,
  ].every((value) => value?.available && value.value != null);
  const useRecentUsage = !completeUsage && !details.isLoading && !details.isError && !!details.data;
  const recentUsage = summarizeRecordedUsage(details.data ?? []);
  const inputTokens = useRecentUsage
    ? recentUsage.inputTokens
    : usage?.totalInputTokens?.available
      ? usage.totalInputTokens.value
      : null;
  const outputTokens = useRecentUsage
    ? recentUsage.outputTokens
    : usage?.totalOutputTokens?.available
      ? usage.totalOutputTokens.value
      : null;
  const totalTokens = useRecentUsage
    ? recentUsage.totalTokens
    : usage?.totalTokens?.available
      ? usage.totalTokens.value
      : null;
  const filtered = (details.data ?? []).filter((row) => {
    const date = new Date(row.createdAt);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return (
      (!search || row.model?.toLowerCase().includes(search.toLowerCase())) &&
      (!kind || row.kind === kind) &&
      (!from || day >= from) &&
      (!to || day <= to)
    );
  });
  const reset = () => {
    setSearch('');
    setKind('');
    setFrom('');
    setTo('');
    setPage(0);
  };

  return (
    <main
      aria-label={titles[section]}
      className={section === 'usage' ? `${styles.page} ${styles.usageScroll}` : styles.page}
    >
      {section === 'plans' && (
        <>
          <div className={styles.period}>
            <span>{translateTravel('按月')}</span>
          </div>
          <div className={styles.plans}>
            {plans.map((plan) => (
              <article className={styles.plan} key={plan.name}>
                <header>
                  <plan.icon aria-hidden />
                  <h2>{plan.name}</h2>
                </header>
                <p className={styles.muted}>{plan.description}</p>
                <div className={styles.price}>
                  <b>{money(plan.price, 'CNY')}</b>
                  <span> {translateTravel('/ 每月')}</span>
                </div>
                <p className={styles.muted}>
                  {isCny
                    ? translateTravel('人民币计价 · 月度套餐')
                    : 'USD reference · Monthly plan · Billed in CNY'}
                </p>
                <Button type="primary" onClick={() => setSelectedPlan(plan)}>
                  {translateTravel('升级')}
                </Button>
                <dl>
                  <dt>{translateTravel('积分')}</dt>
                  <dd>
                    {formatLocalizedTokens(plan.credits, getTravelLocale())}{' '}
                    {translateTravel('/ 每月')}
                  </dd>
                </dl>
                <ul>
                  {[
                    translateTravel('AI 对话与内容创作'),
                    translateTravel('旅游文案与行程攻略'),
                    translateTravel('图片海报与图文笔记'),
                  ].map((text) => (
                    <li key={text}>
                      <Check />
                      {text}
                    </li>
                  ))}
                </ul>
                <div
                  style={{
                    borderTop: `0.5px dashed ${cssVar.colorBorderSecondary}`,
                    marginTop: 20,
                    paddingTop: 4,
                  }}
                >
                  <dl>
                    <dt className={styles.iconLabel}>
                      <FolderOpen aria-hidden size={16} />
                      {translateTravel('文件与知识库')}
                    </dt>
                    <dd>{translateTravel('在对话中使用文件和知识库')}</dd>
                    <dt className={styles.iconLabel}>
                      <ChartNoAxesCombined aria-hidden size={16} />
                      {translateTravel('用量管理')}
                    </dt>
                    <dd>{translateTravel('查看 Token 用量与积分流水')}</dd>
                    <dt className={styles.iconLabel}>
                      <UsersRound aria-hidden size={16} />
                      {translateTravel('群组协作')}
                    </dt>
                    <dd>{translateTravel('与群内成员一起讨论和创作')}</dd>
                  </dl>
                </div>
              </article>
            ))}
          </div>
          <section className={styles.section}>
            <h2>{translateTravel('套餐对比')}</h2>
            <div className={styles.table} style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>
                      <span className={styles.iconLabel}>
                        <Layers aria-hidden size={16} />
                        {translateTravel('套餐权益')}
                      </span>
                    </th>
                    {plans.map((p) => (
                      <th key={p.name}>
                        <span className={styles.iconLabel}>
                          <p.icon aria-hidden size={16} />
                          {p.name}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{translateTravel('每月费用')}</td>
                    {plans.map((p) => (
                      <td key={p.name}>
                        {money(p.price, 'CNY')} / {isCny ? translateTravel('月') : 'month'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>{translateTravel('每月积分')}</td>
                    {plans.map((p) => (
                      <td key={p.name}>{formatLocalizedTokens(p.credits, getTravelLocale())}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>{translateTravel('支付与开通')}</td>
                    {plans.map((p) => (
                      <td key={p.name}>{translateTravel('暂未开放支付')}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <Modal
            footer={null}
            open={Boolean(selectedPlan)}
            styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}
            title={translateTravel('确认套餐')}
            width="min(560px, calc(100vw - 32px))"
            onCancel={() => setSelectedPlan(undefined)}
          >
            {selectedPlan && (
              <Flexbox gap={24} style={{ minWidth: 0 }}>
                <Flexbox horizontal align="center" gap={16}>
                  <selectedPlan.icon aria-hidden size={32} style={{ flexShrink: 0 }} />
                  <Flexbox gap={4}>
                    <Text fontSize={20} weight={600}>
                      {selectedPlan.name}
                    </Text>
                    <Text type="secondary">{selectedPlan.description}</Text>
                  </Flexbox>
                </Flexbox>
                <dl className={styles.planSummary}>
                  <dt>{translateTravel('计费周期')}</dt>
                  <dd>{translateTravel('按月')}</dd>
                  <dt>{translateTravel('每月积分')}</dt>
                  <dd>{formatLocalizedTokens(selectedPlan.credits, getTravelLocale())}</dd>
                  <dt>{translateTravel('应付金额')}</dt>
                  <dd>
                    <Text fontSize={24} weight={600}>
                      {new Intl.NumberFormat(getTravelLocale(), {
                        style: 'currency',
                        currency: 'CNY',
                        currencyDisplay: 'narrowSymbol',
                      }).format(selectedPlan.price)}
                    </Text>
                  </dd>
                </dl>
                {/* Keep plans unavailable even if credit top-up channels are configured. */}
                <PaymentMethods disabled />
                <Alert
                  showIcon
                  title={translateTravel('套餐支付暂未开通')}
                  type="warning"
                  description={translateTravel(
                    '商户审核及套餐开通流程完成后才可付款。当前不会创建订单、扣款或发放积分。',
                  )}
                />
                <Text type="secondary">
                  {translateTravel(
                    '套餐按月计价，与单独充值积分不同。有效期、续费及剩余积分规则将在正式开通前说明。',
                  )}
                </Text>
                <Flexbox horizontal gap={12}>
                  <Button block onClick={() => setSelectedPlan(undefined)}>
                    {translateTravel('返回选择')}
                  </Button>
                  <Button block disabled type="primary">
                    {translateTravel('确认支付')}
                  </Button>
                </Flexbox>
              </Flexbox>
            )}
          </Modal>
        </>
      )}
      {(section === 'usage' || section === 'credits') && (
        <>
          {overview.isLoading ? (
            <SkeletonText rows={3} />
          ) : overview.isError ? (
            <Alert
              title={translateTravel('账户数据暂时无法读取')}
              type="error"
              action={
                <Button onClick={() => void overview.refetch()}>{translateTravel('重试')}</Button>
              }
            />
          ) : section === 'credits' ? (
            <section className={styles.panel}>
              <div className={styles.panelTitle}>
                <span className={styles.iconLabel}>
                  <Coins aria-hidden size={18} />
                  {translateTravel('余额')}
                </span>
                <Button
                  onClick={() =>
                    document.getElementById('credit-purchase')?.scrollIntoView({ block: 'start' })
                  }
                >
                  <Plus size={16} />
                  {translateTravel('充值')}
                </Button>
              </div>
              <div className={styles.balance}>
                <div>
                  <span className={styles.iconLabel}>
                    <Coins aria-hidden size={16} />
                    {translateTravel('可用积分余额')}
                  </span>
                  <strong>{number(account?.availableCredits)}</strong>
                  {!hasAvailableBalance && (
                    <Alert
                      title={translateTravel('账户数据暂时无法读取')}
                      type="error"
                      action={
                        <Button onClick={() => void overview.refetch()}>
                          {translateTravel('重试')}
                        </Button>
                      }
                    />
                  )}
                  <p className={styles.muted}>
                    {translateTravel('订阅积分与充值积分暂未分账；这里显示账户实际可用余额。')}
                  </p>
                </div>
                <div className={styles.membership}>
                  <small>{translateTravel('旅游群 · 个人账户')}</small>
                  <b className={styles.iconLabel}>
                    <Coins aria-hidden size={24} />
                    {translateTravel('积分账户')}
                  </b>
                  <span className={styles.muted}>
                    {translateTravel('可用积分余额')} · {number(account?.availableCredits)}
                  </span>
                  <Link to="/settings/plans">
                    {translateTravel('升级套餐')} <ArrowUpRight size={14} />
                  </Link>
                </div>
              </div>
              <div className={styles.links}>
                <Link to="/settings/usage">
                  <LayoutDashboard aria-hidden size={16} />
                  {translateTravel('查看使用情况')}
                </Link>
                <Button
                  type="default"
                  onClick={() =>
                    document.getElementById('credit-orders')?.scrollIntoView({ block: 'start' })
                  }
                >
                  <History aria-hidden size={16} />
                  {translateTravel('充值记录')}
                </Button>
              </div>
            </section>
          ) : (
            <section className={styles.panel}>
              <div className={styles.panelTitle}>
                <span className={styles.iconLabel}>
                  <LayoutDashboard aria-hidden size={16} />
                  {translateTravel('总览')}
                </span>
                <Link to="/settings/plans">{translateTravel('查看套餐 →')}</Link>
              </div>
              <AvailableTokenEstimate
                credits={account?.availableCredits}
                preferredModel={
                  details.data?.find((row) => row.kind === 'chat' && row.model)?.model
                }
              >
                {(estimate, pricing) => (
                  <div className={styles.metrics}>
                    <div>
                      <span className={`${styles.muted} ${styles.iconLabel}`}>
                        <Coins aria-hidden size={16} />
                        {translateTravel('可用积分')}
                      </span>
                      <strong>{number(account?.availableCredits)}</strong>
                      {estimate}
                      {!hasAvailableBalance && (
                        <Button onClick={() => void overview.refetch()}>
                          {translateTravel('重新读取余额')}
                        </Button>
                      )}
                    </div>
                    <div>
                      <span className={`${styles.muted} ${styles.iconLabel}`}>
                        <Hash aria-hidden size={16} />
                        {translateTravel(useRecentUsage ? '最近记录 Token 用量' : '总 Token 用量')}
                      </span>
                      <UsageTokenMetric
                        input={inputTokens}
                        output={outputTokens}
                        pricing={pricing}
                        tokens={totalTokens}
                      />
                    </div>
                    <div>
                      <span className={`${styles.muted} ${styles.iconLabel}`}>
                        <ArrowDownToLine aria-hidden size={16} />
                        {translateTravel(useRecentUsage ? '最近记录输入 Token' : '输入 Token')}
                      </span>
                      <UsageTokenMetric
                        input={inputTokens}
                        output={0}
                        pricing={pricing}
                        tokens={inputTokens}
                      />
                    </div>
                    <div>
                      <span className={`${styles.muted} ${styles.iconLabel}`}>
                        <ArrowUpFromLine aria-hidden size={16} />
                        {translateTravel(useRecentUsage ? '最近记录输出 Token' : '输出 Token')}
                      </span>
                      <UsageTokenMetric
                        input={0}
                        output={outputTokens}
                        pricing={pricing}
                        tokens={outputTokens}
                      />
                    </div>
                  </div>
                )}
              </AvailableTokenEstimate>
            </section>
          )}
          {section === 'credits' && (
            <>
              <section className={styles.section}>
                <CreditsOrders locale={getTravelLocale()} />
              </section>
              <div
                className={styles.section}
                id="credit-ledger"
                style={{ minWidth: 0, scrollMarginBlock: 24 }}
              >
                <CreditLedger />
              </div>
            </>
          )}
          {section === 'usage' && (
            <section className={styles.section}>
              <h2 className={styles.iconLabel}>
                <List aria-hidden size={18} />
                {translateTravel('明细')}
              </h2>
              {useRecentUsage && (
                <p className={styles.muted}>
                  {translateTravel(
                    '仅汇总已记录的数值，缺失项不计作 0；最近记录不代表账户累计总量。',
                  )}
                </p>
              )}
              <Link to="/settings/credits#credit-ledger">
                {translateTravel('查看实际积分扣费')}
              </Link>
              <p className={styles.muted}>
                {translateTravel(
                  '最近最多 100 条实际用量记录。— 表示暂未记录，不计作 0；积分扣费以账单流水为准。',
                )}
              </p>
              <div className={styles.toolbar}>
                <input
                  aria-label={translateTravel('搜索模型')}
                  placeholder={translateTravel('搜索模型')}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                />
                <select
                  aria-label={translateTravel('用量类型')}
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">{translateTravel('全部类型')}</option>
                  {Object.entries(kindName).map(([key, text]) => (
                    <option key={key} value={key}>
                      {text}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={translateTravel('开始日期')}
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setPage(0);
                  }}
                />
                <input
                  aria-label={translateTravel('结束日期')}
                  min={from}
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setPage(0);
                  }}
                />
                <Button disabled={!search && !kind && !from && !to} onClick={reset}>
                  {translateTravel('重置')}
                </Button>
              </div>
              {details.isLoading ? (
                <SkeletonText rows={3} />
              ) : details.isError ? (
                <Alert
                  title={translateTravel('用量记录暂时无法读取')}
                  type="error"
                  action={
                    <Button onClick={() => void details.refetch()}>
                      {translateTravel('重试')}
                    </Button>
                  }
                />
              ) : (
                <>
                  <div className={styles.table}>
                    <table>
                      <thead>
                        <tr>
                          {[
                            { label: '时间', icon: Clock3 },
                            { label: '类型', icon: Layers },
                            { label: '模型', icon: Cpu },
                            { label: '输入 Token', icon: ArrowDownToLine },
                            { label: '输出 Token', icon: ArrowUpFromLine },
                            { label: '总 Token', icon: Hash },
                            { label: '消耗积分', icon: Coins },
                          ].map(({ label, icon: HeaderIcon }) => (
                            <th key={label} scope="col">
                              <span className={styles.iconLabel}>
                                <HeaderIcon aria-hidden size={16} />
                                {translateTravel(label)}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.slice(page * 10, page * 10 + 10).map((row) => (
                          <tr key={row.id}>
                            <td>
                              {new Date(row.createdAt).toLocaleString(getTravelLocale(), {
                                hour12: false,
                              })}
                            </td>
                            <td>{kindName[row.kind] || row.kind}</td>
                            <td>{row.model || '—'}</td>
                            <td>{number(row.inputTokens)}</td>
                            <td>{number(row.outputTokens)}</td>
                            <td>{number(row.totalTokens)}</td>
                            <td>{translateTravel('未记录')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filtered.length === 0 && (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                          search || kind || from || to
                            ? translateTravel('没有匹配的记录')
                            : translateTravel('暂无用量记录')
                        }
                      />
                    )}
                  </div>
                  <div className={styles.footer}>
                    <span className={styles.muted}>
                      {translateTravel('共')}
                      {filtered.length} {translateTravel('条 · 每页 10 条')}
                    </span>
                    <div>
                      <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
                        {translateTravel('上一页')}
                      </Button>
                      <Button
                        disabled={(page + 1) * 10 >= filtered.length}
                        onClick={() => setPage(page + 1)}
                      >
                        {translateTravel('下一页')}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
      {section === 'usage' && <EnabledModelPricing />}
    </main>
  );
};

export default SubscriptionWorkspace;
