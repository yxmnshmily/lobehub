'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { Button, confirmModal, Input, Switch, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import type { FormEvent } from 'react';
import { memo, useEffect, useRef, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

export interface SponsoredPolicyMember {
  canUsePaidAi: boolean;
  displayName: string | null;
  maxCreditsPerPeriod: number | null;
  maxCreditsPerRequest: number | null;
  membershipVersion: number;
  memberUserId: string;
}

interface SponsoredPolicyPanelProps {
  groupId: string;
  members: SponsoredPolicyMember[];
  onMembersChanged: () => Promise<unknown>;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  field: css`
    min-width: 0;
  `,
  fields: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
  `,
  member: css`
    padding: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  panel: css`
    padding-block-start: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  template: css`
    padding: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
}));

const parsePositiveInteger = (value: string) => {
  if (!/^\d+$/.test(value)) return;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return;
  return parsed;
};

interface MemberLimitRowProps {
  busyAction?: string;
  groupId: string;
  member: SponsoredPolicyMember;
  onChanged: () => Promise<unknown>;
  onFeedback: (message: string, danger?: boolean) => void;
  runAction: (key: string, action: () => Promise<unknown>) => Promise<boolean>;
}

const MemberLimitRow = ({
  busyAction,
  groupId,
  member,
  onChanged,
  onFeedback,
  runAction,
}: MemberLimitRowProps) => {
  const [currentMember, setCurrentMember] = useState(member);
  const [requestLimit, setRequestLimit] = useState(
    member.maxCreditsPerRequest?.toString() ?? '',
  );
  const [periodLimit, setPeriodLimit] = useState(
    member.maxCreditsPerPeriod?.toString() ?? '',
  );
  const displayName = member.displayName || '未命名成员';
  const setMemberLimits = lambdaQuery.groupSponsoredCredit.setMemberLimits.useMutation();
  const revokeMemberPaidAi =
    lambdaQuery.groupSponsoredCredit.revokeMemberPaidAi.useMutation();

  const parsedRequestLimit = parsePositiveInteger(requestLimit);
  const parsedPeriodLimit = parsePositiveInteger(periodLimit);
  const limitsValid = Boolean(
    parsedRequestLimit && parsedPeriodLimit && parsedRequestLimit <= parsedPeriodLimit,
  );

  useEffect(() => {
    setCurrentMember((current) =>
      member.membershipVersion >= current.membershipVersion ? member : current,
    );
  }, [member]);

  useEffect(() => {
    setRequestLimit(currentMember.maxCreditsPerRequest?.toString() ?? '');
    setPeriodLimit(currentMember.maxCreditsPerPeriod?.toString() ?? '');
  }, [currentMember]);

  const handleGrant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!parsedRequestLimit || !parsedPeriodLimit || parsedRequestLimit > parsedPeriodLimit) {
      onFeedback('单次上限必须是正整数，且不能超过周期上限', true);
      return;
    }

    const changed = await runAction(`grant:${member.memberUserId}`, async () => {
      const updated = await setMemberLimits.mutateAsync({
        expectedMembershipVersion: currentMember.membershipVersion,
        groupId,
        maxCreditsPerPeriod: parsedPeriodLimit,
        maxCreditsPerRequest: parsedRequestLimit,
        memberUserId: member.memberUserId,
      });
      setCurrentMember((current) => ({ ...current, ...updated }));
      await onChanged();
    });
    if (!changed) return;
    onFeedback(`已为 ${displayName} 设置代付额度`);
  };

  const handleRevoke = () => {
    if (busyAction) return;
    confirmModal({
      content: '撤销后，该成员不再能使用群主的 Credits。',
      okButtonProps: { danger: true },
      okText: '撤销代付额度',
      onOk: async () => {
        const changed = await runAction(`revoke:${member.memberUserId}`, async () => {
          const updated = await revokeMemberPaidAi.mutateAsync({
            expectedMembershipVersion: currentMember.membershipVersion,
            groupId,
            memberUserId: member.memberUserId,
          });
          setCurrentMember((current) => ({ ...current, ...updated }));
          await onChanged();
        });
        if (!changed) return;
        onFeedback(`已撤销 ${displayName} 的代付额度`);
      },
      title: `撤销 ${displayName} 的代付额度？`,
    });
  };

  return (
    <Flexbox className={styles.member} gap={8}>
      <Text ellipsis fontSize={12} weight={500}>
        {displayName}
      </Text>
      <Text fontSize={12} type="secondary">
        {currentMember.canUsePaidAi &&
        currentMember.maxCreditsPerRequest &&
        currentMember.maxCreditsPerPeriod
          ? `已配置额度：单次 ${currentMember.maxCreditsPerRequest} / 周期 ${currentMember.maxCreditsPerPeriod} Credits`
          : '未授权代付'}
      </Text>
      <form onSubmit={handleGrant}>
        <Flexbox gap={8}>
          <div className={styles.fields}>
            <Input
              aria-label={`${displayName}单次 Credits 上限`}
              className={styles.field}
              disabled={Boolean(busyAction)}
              inputMode="numeric"
              min={1}
              placeholder="单次上限"
              step={1}
              type="number"
              value={requestLimit}
              onChange={(event) => setRequestLimit(event.target.value)}
            />
            <Input
              aria-label={`${displayName}周期 Credits 上限`}
              className={styles.field}
              disabled={Boolean(busyAction)}
              inputMode="numeric"
              min={1}
              placeholder="周期上限"
              step={1}
              type="number"
              value={periodLimit}
              onChange={(event) => setPeriodLimit(event.target.value)}
            />
          </div>
          <Flexbox horizontal gap={4}>
            <Button
              aria-label={`授予 ${displayName} 代付额度`}
              disabled={Boolean(busyAction) || !limitsValid}
              htmlType="submit"
              loading={busyAction === `grant:${member.memberUserId}`}
              size="small"
            >
              设置额度
            </Button>
            <Button
              danger
              aria-label={`撤销 ${displayName} 代付额度`}
              disabled={Boolean(busyAction) || !currentMember.canUsePaidAi}
              loading={busyAction === `revoke:${member.memberUserId}`}
              size="small"
              type="text"
              onClick={handleRevoke}
            >
              撤销
            </Button>
          </Flexbox>
        </Flexbox>
      </form>
    </Flexbox>
  );
};

const SponsoredPolicyPanel = memo<SponsoredPolicyPanelProps>(
  ({ groupId, members, onMembersChanged }) => {
    const [groupLimit, setGroupLimit] = useState('');
    const [periodDays, setPeriodDays] = useState('');
    const [defaultTemplateEnabled, setDefaultTemplateEnabled] = useState(false);
    const [defaultRequestLimit, setDefaultRequestLimit] = useState('');
    const [defaultPeriodLimit, setDefaultPeriodLimit] = useState('');
    const [busyAction, setBusyAction] = useState<string>();
    const [feedback, setFeedback] = useState<{ danger: boolean; message: string }>();
    const actionInFlight = useRef(false);

    const policyQuery = lambdaQuery.groupSponsoredCredit.getOwnerPolicy.useQuery(
      { groupId },
      { enabled: Boolean(groupId), retry: false },
    );
    const enablePolicy = lambdaQuery.groupSponsoredCredit.enablePolicy.useMutation();
    const updatePolicyLimit =
      lambdaQuery.groupSponsoredCredit.updatePolicyLimit.useMutation();
    const disablePolicy = lambdaQuery.groupSponsoredCredit.disablePolicy.useMutation();
    const updateDefaultMemberTemplate =
      lambdaQuery.groupSponsoredCredit.updateDefaultMemberTemplate.useMutation();
    const [policyOverride, setPolicyOverride] = useState<{
      groupId: string;
      value: NonNullable<typeof policyQuery.data>;
    }>();
    const remotePolicy = policyQuery.data;
    const localPolicy = policyOverride?.groupId === groupId ? policyOverride.value : undefined;
    const policy =
      localPolicy && (!remotePolicy || localPolicy.policyVersion >= remotePolicy.policyVersion)
        ? localPolicy
        : remotePolicy;

    useEffect(() => {
      setGroupLimit(policy?.groupPeriodLimitCredits?.toString() ?? '');
      setPeriodDays(
        policy?.periodDurationSeconds
          ? Math.max(1, Math.round(policy.periodDurationSeconds / 86_400)).toString()
          : '',
      );
      setFeedback(undefined);
    }, [groupId, policy?.groupPeriodLimitCredits, policy?.periodDurationSeconds]);

    useEffect(() => {
      setDefaultTemplateEnabled(Boolean(policy?.defaultMemberTemplate?.enabled));
      setDefaultRequestLimit(
        policy?.defaultMemberTemplate?.maxCreditsPerRequest?.toString() ?? '',
      );
      setDefaultPeriodLimit(
        policy?.defaultMemberTemplate?.maxCreditsPerPeriod?.toString() ?? '',
      );
    }, [
      groupId,
      policy?.defaultMemberTemplate?.enabled,
      policy?.defaultMemberTemplate?.maxCreditsPerPeriod,
      policy?.defaultMemberTemplate?.maxCreditsPerRequest,
    ]);

    const showFeedback = (message: string, danger = false) => {
      setFeedback({ danger, message });
    };

    const runAction = async (key: string, action: () => Promise<unknown>) => {
      if (actionInFlight.current) return false;
      actionInFlight.current = true;
      setBusyAction(key);
      setFeedback(undefined);
      try {
        await action();
        return true;
      } catch {
        showFeedback('代付设置未更新，请刷新后重试', true);
        return false;
      } finally {
        actionInFlight.current = false;
        setBusyAction(undefined);
      }
    };

    const handleSavePolicy = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!policy) return;
      const parsedGroupLimit = parsePositiveInteger(groupLimit);
      if (!parsedGroupLimit) {
        showFeedback('请输入正整数的群周期 Credits 上限', true);
        return;
      }

      let changed: boolean;
      if (policy.enabled) {
        changed = await runAction('policy-limit', async () => {
          const updated = await updatePolicyLimit.mutateAsync({
            expectedPolicyVersion: policy.policyVersion,
            groupId,
            groupPeriodLimitCredits: parsedGroupLimit,
          });
          setPolicyOverride({ groupId, value: updated });
          await policyQuery.refetch();
        });
      } else {
        const parsedPeriodDays = parsePositiveInteger(periodDays);
        if (!parsedPeriodDays || parsedPeriodDays > 365) {
          showFeedback('请输入 1 至 365 天的周期', true);
          return;
        }
        changed = await runAction('policy-enable', async () => {
          const updated = await enablePolicy.mutateAsync({
            expectedPolicyVersion: policy.policyVersion,
            groupId,
            groupPeriodLimitCredits: parsedGroupLimit,
            periodDurationSeconds: parsedPeriodDays * 86_400,
          });
          setPolicyOverride({ groupId, value: updated });
          await policyQuery.refetch();
        });
      }
      if (!changed) return;
      showFeedback(policy.enabled ? '群周期上限已更新' : '群代付已启用');
    };

    const handleDisable = () => {
      if (!policy?.enabled || actionInFlight.current) return;
      confirmModal({
        content: '停用后，所有成员将无法继续使用群主的 Credits。',
        okButtonProps: { danger: true },
        okText: '停用群代付',
        onOk: async () => {
          const changed = await runAction('policy-disable', async () => {
            const updated = await disablePolicy.mutateAsync({
              expectedPolicyVersion: policy.policyVersion,
              groupId,
            });
            setPolicyOverride({ groupId, value: updated });
            await policyQuery.refetch();
          });
          if (!changed) return;
          showFeedback('群代付已停用');
        },
        title: '停用群代付？',
      });
    };

    const handleSaveDefaultTemplate = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!policy?.enabled) return;

      const parsedRequestLimit = parsePositiveInteger(defaultRequestLimit);
      const parsedPeriodLimit = parsePositiveInteger(defaultPeriodLimit);
      if (
        defaultTemplateEnabled &&
        (!parsedRequestLimit || !parsedPeriodLimit || parsedRequestLimit > parsedPeriodLimit)
      ) {
        showFeedback('新成员单次上限必须是正整数，且不能超过周期上限', true);
        return;
      }

      const changed = await runAction('default-member-template', async () => {
        const updated = await updateDefaultMemberTemplate.mutateAsync(
          defaultTemplateEnabled
            ? {
                enabled: true,
                expectedPolicyVersion: policy.policyVersion,
                groupId,
                maxCreditsPerPeriod: parsedPeriodLimit!,
                maxCreditsPerRequest: parsedRequestLimit!,
              }
            : {
                enabled: false,
                expectedPolicyVersion: policy.policyVersion,
                groupId,
              },
        );
        setPolicyOverride({ groupId, value: updated });
        await policyQuery.refetch();
      });
      if (!changed) return;
      showFeedback(
        defaultTemplateEnabled ? '新成员代付设置已保存' : '新成员自动代付已关闭',
      );
    };

    if (policyQuery.isLoading) return <Skeleton active paragraph={{ rows: 2 }} title={false} />;
    if (policyQuery.isError || !policy) return null;

    const parsedGroupLimit = parsePositiveInteger(groupLimit);
    const parsedPeriodDays = parsePositiveInteger(periodDays);
    const canSavePolicy = Boolean(
      parsedGroupLimit && (policy.enabled || (parsedPeriodDays && parsedPeriodDays <= 365)),
    );
    const parsedDefaultRequestLimit = parsePositiveInteger(defaultRequestLimit);
    const parsedDefaultPeriodLimit = parsePositiveInteger(defaultPeriodLimit);
    const canSaveDefaultTemplate = Boolean(
      policy.enabled &&
        (!defaultTemplateEnabled ||
          (parsedDefaultRequestLimit &&
            parsedDefaultPeriodLimit &&
            parsedDefaultRequestLimit <= parsedDefaultPeriodLimit)),
    );

    return (
      <Flexbox className={styles.panel} gap={8}>
        <Flexbox gap={2}>
          <Text fontSize={12} weight={500}>
            群代付设置
          </Text>
          <Text fontSize={12} type="secondary">
            获准调用产生的 Credits 由群主承担。这里只设置额度，不代表 AI 能力已开放。
          </Text>
        </Flexbox>

        <form onSubmit={handleSavePolicy}>
          <Flexbox gap={8}>
            <div className={styles.fields}>
              <Input
                aria-label="群周期 Credits 上限"
                className={styles.field}
                disabled={Boolean(busyAction)}
                inputMode="numeric"
                min={1}
                placeholder="群周期上限"
                step={1}
                type="number"
                value={groupLimit}
                onChange={(event) => setGroupLimit(event.target.value)}
              />
              {!policy.enabled && (
                <Input
                  aria-label="周期天数"
                  className={styles.field}
                  disabled={Boolean(busyAction)}
                  inputMode="numeric"
                  max={365}
                  min={1}
                  placeholder="周期天数"
                  step={1}
                  type="number"
                  value={periodDays}
                  onChange={(event) => setPeriodDays(event.target.value)}
                />
              )}
            </div>
            <Flexbox horizontal gap={4}>
              <Button
                disabled={Boolean(busyAction) || !canSavePolicy}
                htmlType="submit"
                loading={busyAction === (policy.enabled ? 'policy-limit' : 'policy-enable')}
                size="small"
                type="primary"
              >
                {policy.enabled ? '更新群上限' : '启用群代付'}
              </Button>
              {policy.enabled && (
                <Button
                  danger
                  disabled={Boolean(busyAction)}
                  loading={busyAction === 'policy-disable'}
                  size="small"
                  type="text"
                  onClick={handleDisable}
                >
                  停用群代付
                </Button>
              )}
            </Flexbox>
          </Flexbox>
        </form>

        <form className={styles.template} onSubmit={handleSaveDefaultTemplate}>
          <Flexbox gap={8}>
            <Flexbox horizontal align="center" gap={8} justify="space-between">
              <Text fontSize={12} weight={500}>
                新成员自动由群主代付
              </Text>
              <Switch
                aria-label="新成员自动由群主代付"
                checked={defaultTemplateEnabled}
                disabled={!policy.enabled || Boolean(busyAction)}
                onChange={setDefaultTemplateEnabled}
              />
            </Flexbox>
            <Text fontSize={12} type="secondary">
              仅作用于此后新建的邀请，不会修改已有成员。
            </Text>
            <div className={styles.fields}>
              <Input
                aria-label="新成员单次 Credits 上限"
                className={styles.field}
                inputMode="numeric"
                min={1}
                placeholder="单次上限"
                step={1}
                type="number"
                value={defaultRequestLimit}
                disabled={
                  !policy.enabled || !defaultTemplateEnabled || Boolean(busyAction)
                }
                onChange={(event) => setDefaultRequestLimit(event.target.value)}
              />
              <Input
                aria-label="新成员周期 Credits 上限"
                className={styles.field}
                inputMode="numeric"
                min={1}
                placeholder="周期上限"
                step={1}
                type="number"
                value={defaultPeriodLimit}
                disabled={
                  !policy.enabled || !defaultTemplateEnabled || Boolean(busyAction)
                }
                onChange={(event) => setDefaultPeriodLimit(event.target.value)}
              />
            </div>
            <Button
              disabled={Boolean(busyAction) || !canSaveDefaultTemplate}
              htmlType="submit"
              loading={busyAction === 'default-member-template'}
              size="small"
            >
              保存新成员代付设置
            </Button>
          </Flexbox>
        </form>

        {feedback && (
          <Text aria-live="polite" fontSize={12} type={feedback.danger ? 'danger' : 'secondary'}>
            {feedback.message}
          </Text>
        )}

        {policy.enabled && members.length > 0 && (
          <Flexbox gap={8}>
            <Text fontSize={12} type="secondary" weight={500}>
              成员代付额度
            </Text>
            {members.map((member) => (
              <MemberLimitRow
                busyAction={busyAction}
                groupId={groupId}
                key={member.memberUserId}
                member={member}
                runAction={runAction}
                onChanged={onMembersChanged}
                onFeedback={showFeedback}
              />
            ))}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default SponsoredPolicyPanel;
