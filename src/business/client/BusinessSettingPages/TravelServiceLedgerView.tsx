import { Block, Flexbox, Input, TextArea } from '@lobehub/ui';
import { Button, Select, Text, toast } from '@lobehub/ui/base-ui';
import { AlertTriangle, Coins, FileClock, Gauge, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { travelServiceLedgerCopy } from '@/business/service-ledger/copy';
import {
  createLedgerIdempotencyKey,
  filterReversibleEntries,
  formatCnyFen,
  formatLedgerDate,
  ledgerTypeLabel,
  orderStatusLabel,
  parseCnyYuanToFen,
  resolveIdempotencyRequest,
} from '@/business/service-ledger/viewModel';
import { lambdaQuery } from '@/libs/trpc/client';

const EmptyPanel = ({ description, title }: { description: string; title: string }) => (
  <Block padding={24} variant={'outlined'}>
    <Flexbox gap={8}>
      <Text weight={600}>{title}</Text>
      <Text color={'secondary'}>{description}</Text>
    </Flexbox>
  </Block>
);

export const CustomerBalanceView = () => {
  const { data, error, isLoading } = lambdaQuery.travelServiceLedger.getAccount.useQuery();

  const title = error
    ? '服务余额暂时无法读取'
    : isLoading || !data
      ? travelServiceLedgerCopy.balance.emptyTitle
      : formatCnyFen(data.balanceFen);

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={10}>
        <Coins size={22} />
        <Text as={'h2'} weight={600}>
          {travelServiceLedgerCopy.balance.title}
        </Text>
      </Flexbox>
      <EmptyPanel description={travelServiceLedgerCopy.balance.description} title={title} />
      <Text color={'secondary'}>{travelServiceLedgerCopy.balance.paymentNotice}</Text>
    </Flexbox>
  );
};

const RecordRow = ({
  amountFen,
  date,
  detail,
  title,
}: {
  amountFen: number;
  date: Date | string;
  detail: string;
  title: string;
}) => (
  <Block padding={16} variant={'outlined'}>
    <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
      <Flexbox gap={4}>
        <Text weight={600}>{title}</Text>
        <Text color={'secondary'}>{`${detail} · ${formatLedgerDate(date)}`}</Text>
      </Flexbox>
      <Text weight={600}>{formatCnyFen(amountFen)}</Text>
    </Flexbox>
  </Block>
);

export const CustomerRecordsView = () => {
  const entriesQuery = lambdaQuery.travelServiceLedger.listEntries.useQuery();
  const ordersQuery = lambdaQuery.travelServiceLedger.listOrders.useQuery();
  const isLoading = entriesQuery.isLoading || ordersQuery.isLoading;
  const error = entriesQuery.error || ordersQuery.error;
  const entries = entriesQuery.data ?? [];
  const orders = ordersQuery.data ?? [];

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={10}>
        <FileClock size={22} />
        <Text as={'h2'} weight={600}>
          {travelServiceLedgerCopy.records.title}
        </Text>
      </Flexbox>
      {error ? (
        <EmptyPanel description={'请稍后重试。'} title={'记录暂时无法读取'} />
      ) : isLoading ? (
        <EmptyPanel
          description={travelServiceLedgerCopy.records.description}
          title={'正在读取记录'}
        />
      ) : entries.length === 0 && orders.length === 0 ? (
        <EmptyPanel
          description={travelServiceLedgerCopy.records.description}
          title={travelServiceLedgerCopy.records.emptyTitle}
        />
      ) : (
        <Flexbox gap={20}>
          {orders.length > 0 && (
            <Flexbox gap={8}>
              <Text weight={600}>{'服务订单'}</Text>
              {orders.map((order) => (
                <RecordRow
                  amountFen={order.amountFen}
                  date={order.createdAt}
                  detail={orderStatusLabel(order.status)}
                  key={order.id}
                  title={order.title}
                />
              ))}
            </Flexbox>
          )}
          {entries.length > 0 && (
            <Flexbox gap={8}>
              <Text weight={600}>{'账本流水'}</Text>
              {entries.map((entry, index) => (
                <RecordRow
                  amountFen={entry.amountFen}
                  date={entry.createdAt}
                  detail={`余额 ${formatCnyFen(entry.balanceAfterFen)}`}
                  key={`${String(entry.createdAt)}:${entry.type}:${entry.amountFen}:${entry.balanceAfterFen}:${index}`}
                  title={ledgerTypeLabel(entry.type)}
                />
              ))}
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
};

const AdminMetric = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) => (
  <Block padding={20} variant={'outlined'}>
    <Flexbox horizontal align={'center'} gap={10}>
      {icon}
      <Flexbox gap={4}>
        <Text weight={600}>{label}</Text>
        <Text color={'secondary'}>{value}</Text>
      </Flexbox>
    </Flexbox>
  </Block>
);

interface AdminAccountRow {
  account: { balanceFen: number; id: string; userId: null | string; userIdSnapshot: string };
  user: null | {
    banned: boolean | null;
    email: null | string;
    fullName: null | string;
    id: string;
    username: null | string;
  };
}

interface AdminLedgerEntry {
  amountFen: number;
  createdAt: Date | string;
  id: string;
  reason: string;
  reversalOfEntryId: null | string;
  type: string;
  userId: null | string;
}

const accountLabel = ({ account, user }: AdminAccountRow) => {
  const name = user
    ? user.fullName || user.username || user.email || user.id
    : `已删除用户 ${account.userIdSnapshot}`;
  return `${name} · ${formatCnyFen(account.balanceFen)}`;
};

const mutationErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const OperationField = ({
  children,
  hint,
  label,
}: {
  children: React.ReactNode;
  hint?: string;
  label: string;
}) => (
  <Flexbox gap={6}>
    <Text fontSize={12} type={'secondary'} weight={500}>
      {label}
    </Text>
    {children}
    {hint && (
      <Text fontSize={12} type={'secondary'}>
        {hint}
      </Text>
    )}
  </Flexbox>
);

const AdminLedgerOperations = ({
  accounts,
  entries,
  onRefresh,
}: {
  accounts: AdminAccountRow[];
  entries: AdminLedgerEntry[];
  onRefresh: () => Promise<unknown>;
}) => {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [orderAmountYuan, setOrderAmountYuan] = useState('');
  const [orderTitle, setOrderTitle] = useState('');
  const [orderError, setOrderError] = useState('');
  const [adjustmentAmountYuan, setAdjustmentAmountYuan] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [adjustmentError, setAdjustmentError] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [reversalReason, setReversalReason] = useState('');
  const [reversalError, setReversalError] = useState('');
  const adjustmentRequest = useRef<null | { key: string; signature: string }>(null);
  const orderRequest = useRef<null | { key: string; signature: string }>(null);
  const reversalRequest = useRef<null | { key: string; signature: string }>(null);
  const orderSubmitting = useRef(false);

  const createOrder = lambdaQuery.travelServiceLedger.adminCreateOrder.useMutation();
  const postAdjustment = lambdaQuery.travelServiceLedger.adminPostManualEntry.useMutation();
  const reverseEntry = lambdaQuery.travelServiceLedger.adminReverseEntry.useMutation();

  const accountOptions = useMemo(
    () =>
      accounts.flatMap((row) =>
        row.user && row.account.userId
          ? [{ label: accountLabel(row), value: row.account.userId }]
          : [],
      ),
    [accounts],
  );
  const reversibleEntries = useMemo(
    () => filterReversibleEntries(entries.filter((entry) => entry.userId === selectedUserId)),
    [entries, selectedUserId],
  );
  const entryOptions = useMemo(
    () =>
      reversibleEntries.map((entry) => ({
        label: `${ledgerTypeLabel(entry.type)} · ${formatCnyFen(entry.amountFen)} · ${entry.reason}`,
        value: entry.id,
      })),
    [reversibleEntries],
  );

  useEffect(() => {
    if (accountOptions.some(({ value }) => value === selectedUserId)) return;
    setSelectedUserId(accountOptions[0]?.value ?? '');
  }, [accountOptions, selectedUserId]);

  useEffect(() => {
    if (reversibleEntries.some(({ id }) => id === selectedEntryId)) return;
    setSelectedEntryId(reversibleEntries[0]?.id ?? '');
  }, [reversibleEntries, selectedEntryId]);

  const resetErrors = () => {
    setOrderError('');
    setAdjustmentError('');
    setReversalError('');
  };

  const refreshAfterMutation = async () => {
    try {
      await onRefresh();
    } catch {
      toast.error('操作已记入账本，但列表刷新失败，请手动刷新页面');
    }
  };

  const submitOrder = async () => {
    if (orderSubmitting.current) return;
    setOrderError('');
    orderSubmitting.current = true;
    try {
      if (!selectedUserId) throw new Error('请选择客户账户');
      const title = orderTitle.trim();
      if (!title) throw new Error('请输入服务订单名称');
      const amountFen = parseCnyYuanToFen(orderAmountYuan, { allowNegative: false });
      const signature = `${selectedUserId}:${amountFen}:${title}`;
      orderRequest.current = resolveIdempotencyRequest(orderRequest.current, signature, 'order');
      await createOrder.mutateAsync({
        amountFen,
        idempotencyKey: orderRequest.current.key,
        targetUserId: selectedUserId,
        title,
      });
      orderRequest.current = null;
      setOrderAmountYuan('');
      setOrderTitle('');
      toast.success('服务订单已创建');
      await refreshAfterMutation();
    } catch (error) {
      const message = mutationErrorMessage(error, '服务订单创建失败，请重试');
      setOrderError(message);
      toast.error(message);
    } finally {
      orderSubmitting.current = false;
    }
  };

  const submitAdjustment = async () => {
    setAdjustmentError('');
    try {
      if (!selectedUserId) throw new Error('请选择客户账户');
      const reason = adjustmentReason.trim();
      if (!reason) throw new Error('请填写人工调账原因');
      const amountFen = parseCnyYuanToFen(adjustmentAmountYuan, { allowNegative: true });
      const signature = `${selectedUserId}:${amountFen}:${reason}`;
      if (adjustmentRequest.current?.signature !== signature) {
        adjustmentRequest.current = {
          key: createLedgerIdempotencyKey('adjustment'),
          signature,
        };
      }
      await postAdjustment.mutateAsync({
        amountFen,
        idempotencyKey: adjustmentRequest.current.key,
        reason,
        targetUserId: selectedUserId,
      });
      adjustmentRequest.current = null;
      setAdjustmentAmountYuan('');
      setAdjustmentReason('');
      toast.success('服务余额已调整');
      await refreshAfterMutation();
    } catch (error) {
      const message = mutationErrorMessage(error, '人工调账失败，请核对金额和原因');
      setAdjustmentError(message);
      toast.error(message);
    }
  };

  const submitReversal = async () => {
    setReversalError('');
    try {
      if (!reversibleEntries.some(({ id }) => id === selectedEntryId)) {
        throw new Error('当前客户没有可冲正流水');
      }
      const reason = reversalReason.trim();
      if (!reason) throw new Error('请填写冲正原因');
      const signature = `${selectedEntryId}:${reason}`;
      if (reversalRequest.current?.signature !== signature) {
        reversalRequest.current = {
          key: createLedgerIdempotencyKey('reversal'),
          signature,
        };
      }
      await reverseEntry.mutateAsync({
        entryId: selectedEntryId,
        idempotencyKey: reversalRequest.current.key,
        reason,
      });
      reversalRequest.current = null;
      setReversalReason('');
      toast.success('账本流水已冲正');
      await refreshAfterMutation();
    } catch (error) {
      const message = mutationErrorMessage(error, '冲正失败，请刷新后重试');
      setReversalError(message);
      toast.error(message);
    }
  };

  const noAccounts = accountOptions.length === 0;

  return (
    <Block padding={20} variant={'outlined'}>
      <Flexbox gap={20}>
        <Flexbox gap={4}>
          <Text weight={600}>{'服务账本操作'}</Text>
          <Text type={'secondary'}>
            {'所有金额以人民币元输入，入账时转换为整数分。不会发起在线支付或自动扣费。'}
          </Text>
        </Flexbox>

        <OperationField label={'客户账户'}>
          <Select
            aria-label={'客户账户'}
            disabled={noAccounts}
            options={accountOptions}
            placeholder={noAccounts ? '暂无客户账户' : '选择真实客户'}
            value={selectedUserId || undefined}
            onChange={(value) => {
              resetErrors();
              setSelectedUserId(String(value));
              setSelectedEntryId('');
            }}
          />
        </OperationField>

        <Flexbox horizontal gap={20} wrap={'wrap'}>
          <Flexbox gap={12} style={{ flex: '1 1 260px', minWidth: 0 }}>
            <Text weight={600}>{'创建服务订单'}</Text>
            <OperationField label={'订单名称'}>
              <Input
                aria-label={'订单名称'}
                maxLength={200}
                placeholder={'例如：定制行程策划'}
                value={orderTitle}
                onChange={(event) => {
                  setOrderError('');
                  setOrderTitle(event.target.value);
                }}
              />
            </OperationField>
            <OperationField hint={'必须大于 0，最多两位小数。'} label={'订单金额（元）'}>
              <Input
                aria-label={'订单金额（元）'}
                inputMode={'decimal'}
                placeholder={'例如：128.00'}
                value={orderAmountYuan}
                onChange={(event) => {
                  setOrderAmountYuan(event.target.value);
                  setOrderError('');
                }}
              />
            </OperationField>
            {orderError && <Text type={'danger'}>{orderError}</Text>}
            <Button disabled={noAccounts} loading={createOrder.isPending} onClick={submitOrder}>
              {'创建服务订单'}
            </Button>
          </Flexbox>

          <Flexbox gap={12} style={{ flex: '1 1 260px', minWidth: 0 }}>
            <Text weight={600}>{'人工调整服务余额'}</Text>
            <OperationField hint={'正数增加余额，负数减少余额。'} label={'调整金额（元）'}>
              <Input
                aria-label={'调整金额（元）'}
                inputMode={'decimal'}
                placeholder={'例如：500.00 或 -50.00'}
                value={adjustmentAmountYuan}
                onChange={(event) => {
                  setAdjustmentAmountYuan(event.target.value);
                  setAdjustmentError('');
                }}
              />
            </OperationField>
            <OperationField label={'调账原因'}>
              <TextArea
                aria-label={'调账原因'}
                autoSize={{ maxRows: 4, minRows: 2 }}
                maxLength={500}
                placeholder={'必填，例如：线下收款凭证已核对'}
                value={adjustmentReason}
                onChange={(event) => {
                  setAdjustmentError('');
                  setAdjustmentReason(event.target.value);
                }}
              />
            </OperationField>
            {adjustmentError && <Text type={'danger'}>{adjustmentError}</Text>}
            <Button
              disabled={noAccounts}
              loading={postAdjustment.isPending}
              type={'primary'}
              onClick={submitAdjustment}
            >
              {'记入人工调账'}
            </Button>
          </Flexbox>

          <Flexbox gap={12} style={{ flex: '1 1 260px', minWidth: 0 }}>
            <Text weight={600}>{'冲正账本流水'}</Text>
            <OperationField hint={'已冲正的流水不会再次出现。'} label={'可冲正流水'}>
              <Select
                aria-label={'可冲正流水'}
                disabled={entryOptions.length === 0}
                options={entryOptions}
                placeholder={entryOptions.length === 0 ? '暂无可冲正流水' : '选择一条流水'}
                value={selectedEntryId || undefined}
                onChange={(value) => {
                  setReversalError('');
                  setSelectedEntryId(String(value));
                }}
              />
            </OperationField>
            <OperationField label={'冲正原因'}>
              <TextArea
                aria-label={'冲正原因'}
                autoSize={{ maxRows: 4, minRows: 2 }}
                maxLength={500}
                placeholder={'必填，说明为什么撤销该笔流水'}
                value={reversalReason}
                onChange={(event) => {
                  setReversalError('');
                  setReversalReason(event.target.value);
                }}
              />
            </OperationField>
            {reversalError && <Text type={'danger'}>{reversalError}</Text>}
            <Button
              danger
              disabled={entryOptions.length === 0}
              loading={reverseEntry.isPending}
              onClick={submitReversal}
            >
              {'冲正所选流水'}
            </Button>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </Block>
  );
};

export const AdminServiceOperationsView = () => {
  const queryOptions = { retry: false } as const;
  const accountsQuery = lambdaQuery.travelServiceLedger.adminListAccounts.useQuery(
    undefined,
    queryOptions,
  );
  const entriesQuery = lambdaQuery.travelServiceLedger.adminListEntries.useQuery(
    undefined,
    queryOptions,
  );
  const ordersQuery = lambdaQuery.travelServiceLedger.adminListOrders.useQuery(
    undefined,
    queryOptions,
  );
  const error = accountsQuery.error || entriesQuery.error || ordersQuery.error;
  const isLoading = accountsQuery.isLoading || entriesQuery.isLoading || ordersQuery.isLoading;
  const accounts = accountsQuery.data ?? [];
  const entries = entriesQuery.data ?? [];
  const orders = ordersQuery.data ?? [];
  const totalBalanceFen = accounts.reduce((total, row) => total + row.account.balanceFen, 0);

  return (
    <Flexbox gap={16}>
      <Flexbox gap={6}>
        <Text as={'h2'} weight={600}>
          {travelServiceLedgerCopy.admin.title}
        </Text>
        <Text color={'secondary'}>{travelServiceLedgerCopy.admin.description}</Text>
      </Flexbox>
      <Flexbox horizontal gap={12} wrap={'wrap'}>
        <AdminMetric
          icon={<Users size={20} />}
          label={'用户账户'}
          value={isLoading ? travelServiceLedgerCopy.admin.pending : accounts.length}
        />
        <AdminMetric
          icon={<Coins size={20} />}
          label={'服务余额'}
          value={isLoading ? travelServiceLedgerCopy.admin.pending : formatCnyFen(totalBalanceFen)}
        />
        <AdminMetric
          icon={<Gauge size={20} />}
          label={'流水 / 订单'}
          value={
            isLoading
              ? travelServiceLedgerCopy.admin.pending
              : `${entries.length} / ${orders.length}`
          }
        />
        <AdminMetric
          icon={<AlertTriangle size={20} />}
          label={'负余额异常'}
          value={accounts.filter(({ account }) => account.balanceFen < 0).length}
        />
      </Flexbox>
      {!error && !isLoading && (
        <AdminLedgerOperations
          accounts={accounts}
          entries={entries}
          onRefresh={() =>
            Promise.all([accountsQuery.refetch(), entriesQuery.refetch(), ordersQuery.refetch()])
          }
        />
      )}
      {error ? (
        <EmptyPanel
          description={'仅全局 super_admin 可读取所有服务账户。'}
          title={'无法读取运营账本'}
        />
      ) : accounts.length === 0 && !isLoading ? (
        <EmptyPanel
          description={travelServiceLedgerCopy.admin.emptyDescription}
          title={travelServiceLedgerCopy.admin.emptyTitle}
        />
      ) : (
        <Flexbox gap={8}>
          {accounts.map(({ account, user }) => (
            <Block key={account.id} padding={16} variant={'outlined'}>
              <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
                <Flexbox gap={4}>
                  <Text weight={600}>
                    {user
                      ? user.fullName || user.username || user.email || user.id
                      : `已删除用户 ${account.userIdSnapshot}`}
                  </Text>
                  <Text color={'secondary'}>
                    {user ? (user.banned ? '已停用' : '正常') : '账户已删除，财务记录保留'}
                  </Text>
                </Flexbox>
                <Text weight={600}>{formatCnyFen(account.balanceFen)}</Text>
              </Flexbox>
            </Block>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
};
