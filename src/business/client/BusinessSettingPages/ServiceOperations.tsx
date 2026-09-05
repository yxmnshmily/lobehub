'use client';

import { Block, Flexbox, Input, TextArea } from '@lobehub/ui';
import { Alert, Button, Select, Tag, Text, toast } from '@lobehub/ui/base-ui';
import type { inferRouterOutputs } from '@trpc/server';
import {
  Ban,
  CheckCircle2,
  Coins,
  FileClock,
  KeyRound,
  Search,
  ShieldAlert,
  UserRoundCog,
  Users,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import type { LambdaRouter } from '@/server/routers/lambda';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { AdminServiceOperationsView as CnyTravelServiceOperationsView } from './TravelServiceLedgerView';
import UserPrivateGroupsSection from './UserPrivateGroupsSection';

const PAGE_SIZE = 20;
const RECENT_LIMIT = 20;
const CREDIT_ENTRIES_LIMIT = 100;
const MODERATION_PAGE_SIZE = 20;
const CONTENT_CATALOG_LIMIT = 5;

type LambdaOutputs = inferRouterOutputs<LambdaRouter>;
type AdminAuditEvent = LambdaOutputs['platformOperations']['listAuditEvents']['items'][number];
type CreditEntry = LambdaOutputs['platformCredit']['listUserEntries'][number];
type ModerationRecord = LambdaOutputs['platformModeration']['listRecords']['items'][number];
type UserSafetyOverview = LambdaOutputs['platformModeration']['getUserSafetyOverview'];
type UserSafetyEvent = UserSafetyOverview['items'][number];
type UserContentCatalog = LambdaOutputs['platformOperations']['getUserContentCatalog'];
type ContentCatalogKind = 'document' | 'generation' | 'work';
type UserOverview = LambdaOutputs['platformOperations']['getUserOverview'];
type UserSessionOverview = LambdaOutputs['platformOperations']['getUserSessionOverview'];
type UserTravelGroupHealthOverview =
  LambdaOutputs['platformOperations']['getUserTravelGroupHealthOverview'];
type UserRow = LambdaOutputs['platformOperations']['listUsers']['items'][number];

const EMPTY_USERS: UserRow[] = [];
const EMPTY_ADMIN_AUDIT_EVENTS: AdminAuditEvent[] = [];
const EMPTY_MODERATION_RECORDS: ModerationRecord[] = [];
const EMPTY_USER_SAFETY_EVENTS: UserSafetyEvent[] = [];
const EMPTY_USER_SESSIONS: UserSessionOverview['items'] = [];

type UserSummary = LambdaOutputs['platformOperations']['getUserSummaries']['items'][number];

interface RetryKey {
  key: string;
  signature: string;
}

interface ContentCatalogFilters {
  endDate: string;
  startDate: string;
  status: string;
  type: string;
}

interface ContentCatalogPagination {
  cursors: Array<string | undefined>;
  pageIndex: number;
  userId: string;
}

const createContentCatalogFilters = (): Record<ContentCatalogKind, ContentCatalogFilters> => ({
  document: { endDate: '', startDate: '', status: '', type: '' },
  generation: { endDate: '', startDate: '', status: '', type: '' },
  work: { endDate: '', startDate: '', status: '', type: '' },
});

const createContentCatalogPagination = (
  userId: string,
): Record<ContentCatalogKind, ContentCatalogPagination> => ({
  document: { cursors: [undefined], pageIndex: 0, userId },
  generation: { cursors: [undefined], pageIndex: 0, userId },
  work: { cursors: [undefined], pageIndex: 0, userId },
});

class OperationValidationError extends Error {}

const redactSensitiveBanReason = (reason: string) =>
  reason
    .replaceAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[已隐藏邮箱]')
    .replaceAll(/(?:\+?86[\s-]?)?1[3-9](?:[\s-]?\d){9}\b/g, '[已隐藏手机号]')
    .replaceAll(/\b[as]k-[\w-]{8,}\b/gi, '[已隐藏密钥]')
    .replaceAll(/\bAKIA[A-Z0-9]{16}\b/g, '[已隐藏密钥]')
    .replaceAll(/\bbearer\s+[\w.~+/-]+=*/gi, '[已隐藏凭证]')
    .replaceAll(
      /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dx]\b/gi,
      '[已隐藏身份证件]',
    )
    .replaceAll(/(?:password|token|api[_ -]?key|密码|密钥)\s*[:：=]\s*\S+/gi, '[已隐藏密钥]');

const containsSensitiveBanReason = (reason: string) => redactSensitiveBanReason(reason) !== reason;

const formatBanReasonForDisplay = (reason: string | null) => {
  const redacted = redactSensitiveBanReason(reason?.trim() || '');
  if (!redacted) return '未记录';

  const characters = Array.from(redacted);
  return characters.length > 80 ? `${characters.slice(0, 80).join('')}…` : redacted;
};

const parseLocalBanExpiry = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new OperationValidationError('封禁到期时间必须是有效的未来本地时间');

  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw] = match;
  const [year, month, day, hour, minute] = [yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw].map(
    Number,
  );
  const expiresAt = new Date(year, month - 1, day, hour, minute, 0, 0);
  const isExactLocalTime =
    expiresAt.getFullYear() === year &&
    expiresAt.getMonth() === month - 1 &&
    expiresAt.getDate() === day &&
    expiresAt.getHours() === hour &&
    expiresAt.getMinutes() === minute;

  if (!isExactLocalTime || expiresAt.getTime() <= Date.now()) {
    throw new OperationValidationError('封禁到期时间必须是有效的未来本地时间');
  }

  return expiresAt;
};

const formatCredits = (credits?: number) =>
  credits !== undefined && Number.isSafeInteger(credits)
    ? `${new Intl.NumberFormat('zh-CN').format(credits)} Credits`
    : 'Credits 暂不可用';

const formatCnyFen = (fen: number) =>
  new Intl.NumberFormat('zh-CN', { currency: 'CNY', style: 'currency' }).format(fen / 100);

const formatDate = (value: Date | string | null) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '无';

const groupStatusLabel = (readiness?: UserOverview['travelGroup']['readiness']) => {
  if (readiness === 'ready') return '群组已就绪';
  if (readiness === 'incomplete') return '群组待补齐';
  if (readiness === 'missing') return '群组未初始化';
  return '群组状态读取中';
};

const entryTypeLabel = (type: CreditEntry['type']) => {
  if (type === 'top_up') return '充值';
  if (type === 'adjustment') return '人工调整';
  if (type === 'usage_charge') return '用量扣费';
  if (type === 'reversal') return '冲正';
  return type;
};

const moderationSourceLabel = (sourceType: ModerationRecord['sourceType']) => {
  if (sourceType === 'chat') return '对话';
  if (sourceType === 'copy') return '文案生成';
  if (sourceType === 'document') return '文档生成';
  if (sourceType === 'image') return '图片生成';
  if (sourceType === 'video') return '视频生成';
  return sourceType;
};

const moderationVerdictLabel = (verdict: ModerationRecord['verdict']) => {
  if (verdict === 'allow') return '通过';
  if (verdict === 'review') return '待人工审核';
  if (verdict === 'block') return '拦截';
  return verdict;
};

const moderationDispositionLabel = (disposition: ModerationRecord['disposition']) => {
  if (disposition === 'pending') return '待处理';
  if (disposition === 'reviewed') return '已复核';
  if (disposition === 'cleared') return '已解除';
  if (disposition === 'ban_recommended') return '已建议封禁';
  return disposition;
};

const moderationCategoryLabel = (category: ModerationRecord['categories'][number]['category']) => {
  if (category === 'credential') return '凭证或密钥';
  if (category === 'email') return '邮箱';
  if (category === 'government_id') return '身份证件';
  if (category === 'phone') return '电话';
  if (category === 'provider_moderation') return '服务商审核';
  return category;
};

const adminAuditActionLabel = (action: AdminAuditEvent['action']) => {
  if (action === 'user.profile_updated') return '资料已修改';
  if (action === 'user.banned') return '账号已封禁';
  if (action === 'user.unbanned') return '账号已解禁';
  if (action === 'user.password_reset_requested') return '密码重置已请求';
  if (action === 'user.sessions_revoked') return '会话已撤销';
  if (action === 'user.travel_group_repaired') return '私人群已安全修复';
  return action;
};

const adminAuditPhaseLabel = (phase: AdminAuditEvent['phase']) => {
  if (phase === 'requested') return '已请求';
  if (phase === 'succeeded') return '成功';
  if (phase === 'failed') return '失败';
  return phase;
};

const parseCredits = (raw: string, positiveOnly: boolean) => {
  const value = raw.trim();
  if (!/^[+-]?\d+$/.test(value)) {
    throw new OperationValidationError('Credits 必须为安全范围内的整数');
  }

  const credits = Number(value);
  if (!Number.isSafeInteger(credits)) {
    throw new OperationValidationError('Credits 必须为安全范围内的整数');
  }
  if (credits === 0) throw new OperationValidationError('Credits 不能为 0');
  if (positiveOnly && credits < 1) {
    throw new OperationValidationError('充值 Credits 必须大于 0');
  }

  return credits;
};

const createIdempotencyKey = (kind: 'adjust' | 'reversal' | 'top-up') => {
  const suffix =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `admin-ui:${kind}:${suffix}`;
};

const resolveRetryKey = (
  ref: React.MutableRefObject<RetryKey | null>,
  kind: 'adjust' | 'reversal' | 'top-up',
  signature: string,
) => {
  if (ref.current?.signature === signature) return ref.current.key;
  const key = createIdempotencyKey(kind);
  ref.current = { key, signature };
  return key;
};

const Field = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <Flexbox gap={6}>
    <Text as={'label'} fontSize={12} weight={500}>
      {label}
    </Text>
    {children}
  </Flexbox>
);

const Metric = ({ label, value }: { label: string; value: string }) => (
  <Block padding={16} variant={'outlined'}>
    <Flexbox gap={4}>
      <Text color={'secondary'} fontSize={12}>
        {label}
      </Text>
      <Text weight={600}>{value}</Text>
    </Flexbox>
  </Block>
);

const UserAdminAuditSection = ({
  error,
  events,
  loading,
}: {
  error: unknown;
  events: AdminAuditEvent[];
  loading: boolean;
}) => (
  <Block padding={20} variant={'outlined'}>
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={8}>
        <FileClock size={18} />
        <Text weight={600}>{'最近安全操作'}</Text>
      </Flexbox>
      <Text color={'secondary'}>
        {'仅显示管理员、目标用户、操作类型、阶段和时间，不读取操作内容、幂等标识或认证数据。'}
      </Text>
      {error ? (
        <Alert title={'最近安全操作暂时无法读取'} />
      ) : loading ? (
        <Text color={'secondary'}>{'正在读取最近安全操作…'}</Text>
      ) : events.length === 0 ? (
        <Text color={'secondary'}>{'暂无安全操作记录'}</Text>
      ) : (
        <Flexbox gap={8}>
          {events.map((event) => (
            <Block
              key={`${event.operatorUserId}-${event.targetUserId}-${event.action}-${event.phase}-${String(event.occurredAt)}`}
              padding={12}
              variant={'outlined'}
            >
              <Flexbox gap={5}>
                <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                  <Text weight={600}>{adminAuditActionLabel(event.action)}</Text>
                  <Tag color={event.phase === 'failed' ? 'red' : 'green'}>
                    {adminAuditPhaseLabel(event.phase)}
                  </Tag>
                </Flexbox>
                <Text color={'secondary'}>{`操作管理员：${event.operatorUserId}`}</Text>
                <Text color={'secondary'}>{`目标用户：${event.targetUserId}`}</Text>
                <Text color={'secondary'}>{`操作时间：${formatDate(event.occurredAt)}`}</Text>
              </Flexbox>
            </Block>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  </Block>
);

const UserContentCatalogSection = ({
  catalogs,
  errors,
  filterInputs,
  loading,
  onApplyFilters,
  onFilterInputChange,
  onNextPage,
  onPreviousPage,
  onRetry,
  pageIndexes,
}: {
  catalogs: {
    document: UserContentCatalog | undefined;
    generation: UserContentCatalog | undefined;
    work: UserContentCatalog | undefined;
  };
  errors: Record<ContentCatalogKind, unknown>;
  filterInputs: Record<ContentCatalogKind, ContentCatalogFilters>;
  loading: Record<ContentCatalogKind, boolean>;
  onApplyFilters: (kind: ContentCatalogKind) => void;
  onFilterInputChange: (
    kind: ContentCatalogKind,
    field: keyof ContentCatalogFilters,
    value: string,
  ) => void;
  onNextPage: (kind: ContentCatalogKind, cursor: string) => void;
  onPreviousPage: (kind: ContentCatalogKind) => void;
  onRetry: (kind: ContentCatalogKind) => void;
  pageIndexes: Record<ContentCatalogKind, number>;
}) => {
  const counts = catalogs.generation?.counts ?? catalogs.work?.counts ?? catalogs.document?.counts;
  const sections = [
    {
      count: counts?.generationTasks,
      items: catalogs.generation?.items ?? [],
      kind: 'generation' as const,
      label: '生成任务',
      nextCursor: catalogs.generation?.nextCursor,
    },
    {
      count: counts?.works,
      items: catalogs.work?.items ?? [],
      kind: 'work' as const,
      label: '作品',
      nextCursor: catalogs.work?.nextCursor,
    },
    {
      count: counts?.documents,
      items: catalogs.document?.items ?? [],
      kind: 'document' as const,
      label: '文档',
      nextCursor: catalogs.document?.nextCursor,
    },
  ];

  return (
    <Block padding={20} variant={'outlined'}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          <FileClock size={18} />
          <Text weight={600}>{'内容摘要'}</Text>
        </Flexbox>
        <Text color={'secondary'}>
          {
            '仅展示目录级摘要，不读取正文、原始提示词或服务商数据。删除内容或封禁用户必须走单独确认流程，本区不提供删除能力。'
          }
        </Text>

        <Flexbox gap={12}>
          {sections.map((section) => {
            const filters = filterInputs[section.kind];
            return (
              <Block
                aria-label={`${section.label}内容目录`}
                key={section.kind}
                padding={12}
                role={'region'}
                variant={'outlined'}
              >
                <Flexbox gap={8}>
                  <Text weight={600}>{`${section.label} ${section.count ?? 0}`}</Text>
                  <Flexbox horizontal align={'end'} gap={8} wrap={'wrap'}>
                    <Field label={`${section.label}类型`}>
                      <Input
                        aria-label={`${section.label}类型`}
                        maxLength={100}
                        placeholder={'全部类型'}
                        value={filters.type}
                        onChange={(event) =>
                          onFilterInputChange(section.kind, 'type', event.currentTarget.value)
                        }
                      />
                    </Field>
                    {section.kind !== 'document' && (
                      <Field label={`${section.label}状态`}>
                        <Input
                          aria-label={`${section.label}状态`}
                          maxLength={100}
                          placeholder={'全部状态'}
                          value={filters.status}
                          onChange={(event) =>
                            onFilterInputChange(section.kind, 'status', event.currentTarget.value)
                          }
                        />
                      </Field>
                    )}
                    <Field label={`${section.label}开始日期`}>
                      <Input
                        aria-label={`${section.label}开始日期`}
                        type={'date'}
                        value={filters.startDate}
                        onChange={(event) =>
                          onFilterInputChange(section.kind, 'startDate', event.currentTarget.value)
                        }
                      />
                    </Field>
                    <Field label={`${section.label}结束日期`}>
                      <Input
                        aria-label={`${section.label}结束日期`}
                        type={'date'}
                        value={filters.endDate}
                        onChange={(event) =>
                          onFilterInputChange(section.kind, 'endDate', event.currentTarget.value)
                        }
                      />
                    </Field>
                    <Button onClick={() => onApplyFilters(section.kind)}>
                      {`应用${section.label}筛选`}
                    </Button>
                  </Flexbox>

                  {errors[section.kind] ? (
                    <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                      <Alert title={`${section.label}内容摘要暂时无法读取`} />
                      <Button onClick={() => onRetry(section.kind)}>
                        {`重试${section.label}内容摘要`}
                      </Button>
                    </Flexbox>
                  ) : loading[section.kind] ? (
                    <Text color={'secondary'}>{`正在读取${section.label}内容摘要…`}</Text>
                  ) : section.items.length === 0 ? (
                    <Text color={'secondary'}>{'暂无匹配条目'}</Text>
                  ) : (
                    section.items.map((item) => (
                      <Block key={`${item.kind}-${item.id}`} padding={10} variant={'outlined'}>
                        <Flexbox gap={5}>
                          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                            <Text weight={600}>{item.title || item.filename || item.id}</Text>
                            <Tag>{item.type}</Tag>
                            {item.status && <Tag>{item.status}</Tag>}
                          </Flexbox>
                          {item.filename && (
                            <Text color={'secondary'}>{`文件名：${item.filename}`}</Text>
                          )}
                          <Text color={'secondary'}>{`ID：${item.id}`}</Text>
                          <Text
                            color={'secondary'}
                          >{`创建时间：${formatDate(item.createdAt)}`}</Text>
                          <Text
                            color={'secondary'}
                          >{`更新时间：${formatDate(item.updatedAt)}`}</Text>
                        </Flexbox>
                      </Block>
                    ))
                  )}

                  {!errors[section.kind] && !loading[section.kind] && (
                    <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                      <Button
                        disabled={pageIndexes[section.kind] === 0}
                        onClick={() => onPreviousPage(section.kind)}
                      >
                        {`${section.label}上一页`}
                      </Button>
                      <Button
                        disabled={!section.nextCursor}
                        onClick={() => {
                          if (section.nextCursor) onNextPage(section.kind, section.nextCursor);
                        }}
                      >
                        {`${section.label}下一页`}
                      </Button>
                    </Flexbox>
                  )}
                </Flexbox>
              </Block>
            );
          })}
        </Flexbox>
      </Flexbox>
    </Block>
  );
};

const UserTravelGroupHealthSection = ({
  error,
  loading,
  onChanged,
  overview,
  targetActive,
  userId,
}: {
  error: unknown;
  loading: boolean;
  onChanged: () => Promise<void>;
  overview: UserTravelGroupHealthOverview | undefined;
  targetActive: boolean;
  userId: string;
}) => {
  const manualReviewIssueCodes = new Set(['DEFAULT_GROUP_DUPLICATED', 'SUPERVISOR_COUNT_INVALID']);
  const [confirmationFingerprint, setConfirmationFingerprint] = useState('');
  const [actionError, setActionError] = useState('');
  const [repairing, setRepairing] = useState(false);
  const actionInFlightRef = useRef(false);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const repairMutation = lambdaQuery.platformOperations.repairUserTravelGroup.useMutation();
  const canRepair = Boolean(
    targetActive &&
    overview?.canRepair &&
    !overview.ready &&
    !overview.reviewRequired &&
    overview.actionCounts.length > 0,
  );

  const repairTravelGroup = async () => {
    if (actionInFlightRef.current || !canRepair || !confirmationFingerprint) return;
    actionInFlightRef.current = true;
    setRepairing(true);
    setActionError('');
    try {
      await repairMutation.mutateAsync({
        confirmed: true,
        planFingerprint: confirmationFingerprint,
        targetUserId: userId,
      });
      setConfirmationFingerprint('');
      toast.success('私人旅游群已按安全预案修复');
      try {
        await onChanged();
      } catch {
        toast.error('修复已成功，但最新健康状态刷新失败，请手动刷新页面');
      }
    } catch {
      setActionError('私人旅游群未安全完成修复，请重新读取预案后重试');
      toast.error('私人旅游群未安全完成修复，请重试');
    } finally {
      actionInFlightRef.current = false;
      setRepairing(false);
    }
  };

  return (
    <Block
      aria-label={'私人群健康与修复预案'}
      padding={20}
      role={'region'}
      style={{ maxWidth: '100%', minWidth: 0 }}
      variant={'outlined'}
    >
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <ShieldAlert size={18} />
            <Text weight={600}>{'私人群健康与修复预案'}</Text>
          </Flexbox>
          <Tag color={overview ? (overview.ready ? 'green' : 'red') : undefined}>
            {overview ? (overview.ready ? '状态：健康' : '状态：需检查') : '状态：读取中'}
          </Tag>
        </Flexbox>
        <Text color={'secondary'}>
          {
            '仅展示固定问题代码和建议动作计数；安全预案需要管理员明确确认，且服务端会在执行前重新校验。'
          }
        </Text>

        {error ? (
          <Alert title={'私人群健康与修复预案暂时无法读取'} />
        ) : loading || !overview ? (
          <Text color={'secondary'}>{'正在读取私人群健康…'}</Text>
        ) : (
          <>
            {overview.reviewRequired && <Alert title={'需要人工审核，不会自动修复'} />}
            {!targetActive && <Alert title={'目标用户已封禁，不允许执行私人群修复'} />}

            <Flexbox gap={6}>
              <Text weight={600}>{'群健康问题代码'}</Text>
              {overview.issueCodes.length === 0 ? (
                <Text color={'secondary'}>{'未发现已知问题代码'}</Text>
              ) : (
                <div
                  aria-label={'群健康问题代码'}
                  role={'list'}
                  style={{
                    display: 'grid',
                    gap: 8,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
                    minWidth: 0,
                  }}
                >
                  {overview.issueCodes.map((code) => (
                    <div
                      key={code}
                      role={'listitem'}
                      style={{ minWidth: 0, overflowWrap: 'anywhere' }}
                    >
                      <Tag color={manualReviewIssueCodes.has(code) ? 'red' : 'gold'}>{code}</Tag>
                    </div>
                  ))}
                </div>
              )}
            </Flexbox>

            <Flexbox gap={6}>
              <Text weight={600}>{'建议动作预览'}</Text>
              {overview.actionCounts.length === 0 ? (
                <Text color={'secondary'}>{'无建议动作'}</Text>
              ) : (
                <Flexbox horizontal gap={8} style={{ minWidth: 0 }} wrap={'wrap'}>
                  {overview.actionCounts.map(({ code, count }) => (
                    <Tag color={code.includes('REVIEW_REQUIRED') ? 'red' : 'gold'} key={code}>
                      {`${code} × ${count}`}
                    </Tag>
                  ))}
                </Flexbox>
              )}
            </Flexbox>

            {canRepair && (
              <>
                <Button
                  disabled={repairing || repairMutation.isPending}
                  style={{ maxWidth: '100%', width: 'fit-content' }}
                  type={'primary'}
                  onClick={() => {
                    setActionError('');
                    setConfirmationFingerprint(overview.planFingerprint);
                  }}
                >
                  {'执行安全修复'}
                </Button>
                {confirmationFingerprint && (
                  <Flexbox
                    aria-describedby={dialogDescriptionId}
                    aria-labelledby={dialogTitleId}
                    gap={10}
                    role={'alertdialog'}
                    style={{ maxWidth: '100%', minWidth: 0 }}
                  >
                    <Text id={dialogTitleId} weight={600}>
                      {'确认修复该用户的私人旅游群？'}
                    </Text>
                    <Text color={'secondary'} id={dialogDescriptionId}>
                      {'只执行上方已预览的安全白名单动作；如果群状态已变化，服务端将拒绝执行。'}
                    </Text>
                    <Flexbox horizontal gap={8} style={{ minWidth: 0 }} wrap={'wrap'}>
                      <Button
                        autoFocus
                        disabled={repairing || repairMutation.isPending}
                        onClick={() => setConfirmationFingerprint('')}
                      >
                        {'取消'}
                      </Button>
                      <Button
                        disabled={repairing || repairMutation.isPending}
                        loading={repairing || repairMutation.isPending}
                        type={'primary'}
                        onClick={repairTravelGroup}
                      >
                        {'确认执行安全修复'}
                      </Button>
                    </Flexbox>
                  </Flexbox>
                )}
              </>
            )}
            {actionError && <Alert title={actionError} />}
          </>
        )}
      </Flexbox>
    </Block>
  );
};

const UserSessionOverviewSection = ({
  error,
  loading,
  onChanged,
  overview,
  userId,
}: {
  error: unknown;
  loading: boolean;
  onChanged: () => Promise<void>;
  overview: UserSessionOverview | undefined;
  userId: string;
}) => {
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [revoking, setRevoking] = useState(false);
  const actionInFlightRef = useRef(false);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const revokeMutation = lambdaQuery.platformOperations.revokeUserSessions.useMutation();
  const isCurrentAdministrator = Boolean(currentUserId) && currentUserId === userId;
  const sessions = overview?.items ?? EMPTY_USER_SESSIONS;

  const revokeSessions = async () => {
    if (actionInFlightRef.current || isCurrentAdministrator) return;
    actionInFlightRef.current = true;
    setRevoking(true);
    setActionError('');
    try {
      await revokeMutation.mutateAsync({ targetUserId: userId });
      setConfirmationOpen(false);
      toast.success('该用户的全部会话已撤销');
      try {
        await onChanged();
      } catch {
        toast.error('会话已撤销，但最新数据刷新失败，请手动刷新页面');
      }
    } catch {
      setActionError('会话撤销未安全完成，请重试');
      toast.error('会话撤销未安全完成，请重试');
    } finally {
      actionInFlightRef.current = false;
      setRevoking(false);
    }
  };

  return (
    <Block padding={20} variant={'outlined'}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <ShieldAlert size={18} />
            <Text weight={600}>{'登录会话安全概览'}</Text>
          </Flexbox>
          <Text color={'secondary'}>{`会话总数：${overview?.total ?? '—'}`}</Text>
        </Flexbox>
        <Text color={'secondary'}>
          {'仅显示最近 10 条会话的时间、过期时间、IP 和 User-Agent；不读取 token 或 Cookie。'}
        </Text>

        {error ? (
          <Alert title={'登录会话暂时无法读取'} />
        ) : loading ? (
          <Text color={'secondary'}>{'正在读取登录会话…'}</Text>
        ) : sessions.length === 0 ? (
          <Text color={'secondary'}>{'暂无有效登录会话记录'}</Text>
        ) : (
          <Flexbox gap={8}>
            {sessions.map((session, index) => (
              <Block
                key={`${String(session.updatedAt)}-${String(session.createdAt)}-${index}`}
                padding={12}
                variant={'outlined'}
              >
                <Flexbox gap={5}>
                  <Text>{`创建时间：${formatDate(session.createdAt)}`}</Text>
                  <Text color={'secondary'}>{`更新时间：${formatDate(session.updatedAt)}`}</Text>
                  <Text color={'secondary'}>{`过期时间：${formatDate(session.expiresAt)}`}</Text>
                  <Text color={'secondary'}>{`IP：${session.ipAddress || '未记录'}`}</Text>
                  <Text color={'secondary'}>{`User-Agent：${session.userAgent || '未记录'}`}</Text>
                </Flexbox>
              </Block>
            ))}
          </Flexbox>
        )}

        {isCurrentAdministrator ? (
          <Alert title={'当前管理员请在个人中心管理自己的会话'} />
        ) : (
          <>
            <Button
              danger
              disabled={revoking || revokeMutation.isPending}
              onClick={() => {
                setActionError('');
                setConfirmationOpen(true);
              }}
            >
              {'撤销该用户全部会话'}
            </Button>
            {confirmationOpen && (
              <Flexbox
                aria-describedby={dialogDescriptionId}
                aria-labelledby={dialogTitleId}
                gap={10}
                role={'alertdialog'}
              >
                <Text id={dialogTitleId} weight={600}>
                  {'确认撤销该用户全部会话？'}
                </Text>
                <Text color={'secondary'} id={dialogDescriptionId}>
                  {'确认后，该用户所有设备都需要重新登录。'}
                </Text>
                <Flexbox horizontal gap={8} wrap={'wrap'}>
                  <Button
                    autoFocus
                    disabled={revoking || revokeMutation.isPending}
                    onClick={() => setConfirmationOpen(false)}
                  >
                    {'取消'}
                  </Button>
                  <Button
                    danger
                    disabled={revoking || revokeMutation.isPending}
                    loading={revoking || revokeMutation.isPending}
                    onClick={revokeSessions}
                  >
                    {'确认撤销全部会话'}
                  </Button>
                </Flexbox>
              </Flexbox>
            )}
          </>
        )}
        {actionError && <Alert title={actionError} />}
      </Flexbox>
    </Block>
  );
};

const UserModerationSafetyOverviewSection = ({ userId }: { userId: string }) => {
  const [categoryInput, setCategoryInput] = useState<
    '' | UserSafetyEvent['categories'][number]['category']
  >('');
  const [severityInput, setSeverityInput] = useState<
    '' | UserSafetyEvent['categories'][number]['severity']
  >('');
  const [statusInput, setStatusInput] = useState<'' | UserSafetyEvent['disposition']>('');
  const [startDateInput, setStartDateInput] = useState('');
  const [endDateInput, setEndDateInput] = useState('');
  const [filters, setFilters] = useState({
    category: '',
    endDate: '',
    severity: '',
    startDate: '',
    status: '',
  });
  const [pageIndex, setPageIndex] = useState(0);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);

  const overviewQuery = lambdaQuery.platformModeration.getUserSafetyOverview.useQuery(
    {
      category:
        (filters.category as UserSafetyEvent['categories'][number]['category']) || undefined,
      cursor: cursors[pageIndex],
      endAt: filters.endDate ? new Date(`${filters.endDate}T23:59:59.999Z`) : undefined,
      limit: 10,
      severity:
        (filters.severity as UserSafetyEvent['categories'][number]['severity']) || undefined,
      startAt: filters.startDate ? new Date(`${filters.startDate}T00:00:00.000Z`) : undefined,
      status: (filters.status as UserSafetyEvent['disposition']) || undefined,
      targetUserId: userId,
    },
    { enabled: Boolean(userId), retry: false },
  );
  const items = overviewQuery.data?.items ?? EMPTY_USER_SAFETY_EVENTS;
  const summary = overviewQuery.data?.summary;

  const applyFilters = () => {
    setFilters({
      category: categoryInput,
      endDate: endDateInput,
      severity: severityInput,
      startDate: startDateInput,
      status: statusInput,
    });
    setCursors([undefined]);
    setPageIndex(0);
  };

  return (
    <Block aria-label={'敏感信息安全概览'} padding={20} role={'region'} variant={'outlined'}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          <ShieldAlert size={18} />
          <Text weight={600}>{'敏感信息安全概览'}</Text>
        </Flexbox>
        <Text color={'secondary'}>
          {
            '仅显示汇总计数、固定检测分类、结论、处置状态、时间和安全标识；不读取原文、提示词、消息正文或认证数据。本区不提供删除或封禁操作。'
          }
        </Text>

        <Flexbox horizontal gap={8} wrap={'wrap'}>
          <Tag>{`命中总数 ${summary?.total ?? '—'}`}</Tag>
          <Tag color={'red'}>{`拦截 ${summary?.block ?? '—'}`}</Tag>
          <Tag color={'gold'}>{`待人工审核 ${summary?.review ?? '—'}`}</Tag>
          <Tag>{`待处理 ${summary?.pending ?? '—'}`}</Tag>
          <Tag>{`已复核 ${summary?.reviewed ?? '—'}`}</Tag>
        </Flexbox>

        <Flexbox horizontal align={'end'} gap={8} wrap={'wrap'}>
          <Field label={'安全分类'}>
            <Select
              aria-label={'安全分类'}
              value={categoryInput}
              options={[
                { label: '全部分类', value: '' },
                { label: '凭证或密钥', value: 'credential' },
                { label: '邮箱', value: 'email' },
                { label: '身份证件', value: 'government_id' },
                { label: '电话', value: 'phone' },
                { label: '服务商审核', value: 'provider_moderation' },
              ]}
              onChange={(value) =>
                setCategoryInput(value as '' | UserSafetyEvent['categories'][number]['category'])
              }
            />
          </Field>
          <Field label={'严重级别'}>
            <Select
              aria-label={'严重级别'}
              value={severityInput}
              options={[
                { label: '全部级别', value: '' },
                { label: '严重', value: 'critical' },
                { label: '高', value: 'high' },
                { label: '中', value: 'medium' },
              ]}
              onChange={(value) =>
                setSeverityInput(value as '' | UserSafetyEvent['categories'][number]['severity'])
              }
            />
          </Field>
          <Field label={'安全处置状态'}>
            <Select
              aria-label={'安全处置状态'}
              value={statusInput}
              options={[
                { label: '全部状态', value: '' },
                { label: '待处理', value: 'pending' },
                { label: '已复核', value: 'reviewed' },
                { label: '已解除', value: 'cleared' },
                { label: '已建议封禁', value: 'ban_recommended' },
              ]}
              onChange={(value) => setStatusInput(value as '' | UserSafetyEvent['disposition'])}
            />
          </Field>
          <Field label={'开始日期'}>
            <Input
              aria-label={'开始日期'}
              type={'date'}
              value={startDateInput}
              onChange={(event) => setStartDateInput(event.currentTarget.value)}
            />
          </Field>
          <Field label={'结束日期'}>
            <Input
              aria-label={'结束日期'}
              type={'date'}
              value={endDateInput}
              onChange={(event) => setEndDateInput(event.currentTarget.value)}
            />
          </Field>
          <Button onClick={applyFilters}>{'应用安全筛选'}</Button>
        </Flexbox>

        {overviewQuery.error ? (
          <Alert title={'敏感信息安全概览暂时无法读取'} />
        ) : overviewQuery.isLoading ? (
          <Text color={'secondary'}>{'正在读取安全事件…'}</Text>
        ) : items.length === 0 ? (
          <Text color={'secondary'}>{'暂无匹配的安全事件'}</Text>
        ) : (
          <Flexbox gap={8}>
            {items.map((item) => (
              <Block key={item.id} padding={12} variant={'outlined'}>
                <Flexbox gap={5}>
                  <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                    <Text weight={600}>{moderationSourceLabel(item.sourceType)}</Text>
                    <Tag color={item.verdict === 'block' ? 'red' : 'gold'}>
                      {moderationVerdictLabel(item.verdict)}
                    </Tag>
                    <Tag>{moderationDispositionLabel(item.disposition)}</Tag>
                  </Flexbox>
                  <Flexbox horizontal gap={6} wrap={'wrap'}>
                    {item.categories.map((finding) => (
                      <Tag key={`${finding.category}-${finding.severity}`}>
                        {`${moderationCategoryLabel(finding.category)} · ${finding.severity} · ${finding.count}`}
                      </Tag>
                    ))}
                  </Flexbox>
                  <Text color={'secondary'}>{`安全事件 ID：${item.id}`}</Text>
                  <Text color={'secondary'}>{`检测时间：${formatDate(item.detectedAt)}`}</Text>
                  <Text color={'secondary'}>{`处置时间：${formatDate(item.disposedAt)}`}</Text>
                </Flexbox>
              </Block>
            ))}
          </Flexbox>
        )}

        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Button disabled={pageIndex === 0} onClick={() => setPageIndex((value) => value - 1)}>
            {'安全事件上一页'}
          </Button>
          <Button
            disabled={!overviewQuery.data?.nextCursor}
            onClick={() => {
              const nextCursor = overviewQuery.data?.nextCursor;
              if (!nextCursor) return;
              setCursors((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
              setPageIndex((value) => value + 1);
            }}
          >
            {'安全事件下一页'}
          </Button>
        </Flexbox>
      </Flexbox>
    </Block>
  );
};

const ModerationSection = () => {
  const [userIdInput, setUserIdInput] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [dispositionInput, setDispositionInput] = useState<'' | ModerationRecord['disposition']>(
    '',
  );
  const [dispositionFilter, setDispositionFilter] = useState<'' | ModerationRecord['disposition']>(
    '',
  );
  const [verdictInput, setVerdictInput] = useState<'' | ModerationRecord['verdict']>('');
  const [verdictFilter, setVerdictFilter] = useState<'' | ModerationRecord['verdict']>('');
  const [offset, setOffset] = useState(0);
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [moderationError, setModerationError] = useState('');
  const [activeDisposition, setActiveDisposition] = useState<
    'ban_recommended' | 'cleared' | 'reviewed' | null
  >(null);
  const dispositionInFlightRef = useRef(false);

  const recordsQuery = lambdaQuery.platformModeration.listRecords.useQuery(
    {
      disposition: dispositionFilter || undefined,
      limit: MODERATION_PAGE_SIZE,
      offset,
      userId: userIdFilter || undefined,
      verdict: verdictFilter || undefined,
    },
    { retry: false },
  );
  const detailQuery = lambdaQuery.platformModeration.getRecord.useQuery(
    { id: selectedRecordId },
    { enabled: Boolean(selectedRecordId), retry: false },
  );
  const markReviewedMutation = lambdaQuery.platformModeration.markReviewed.useMutation();
  const clearMutation = lambdaQuery.platformModeration.clear.useMutation();
  const recommendBanMutation = lambdaQuery.platformModeration.recommendBan.useMutation();

  const records = recordsQuery.data?.items ?? EMPTY_MODERATION_RECORDS;
  const total = recordsQuery.data?.total ?? 0;

  const applyFilters = () => {
    setOffset(0);
    setSelectedRecordId('');
    setModerationError('');
    setUserIdFilter(userIdInput.trim());
    setDispositionFilter(dispositionInput);
    setVerdictFilter(verdictInput);
  };

  const refreshModeration = async () => {
    const refreshResults = await Promise.allSettled([
      recordsQuery.refetch(),
      detailQuery.refetch(),
    ]);
    if (refreshResults.some((result) => result.status === 'rejected')) {
      toast.error('处置已成功，但审计数据刷新失败，请手动刷新页面');
    }
  };

  const setDisposition = async (action: 'ban_recommended' | 'cleared' | 'reviewed') => {
    if (!selectedRecordId || dispositionInFlightRef.current) return;
    dispositionInFlightRef.current = true;
    setActiveDisposition(action);
    setModerationError('');
    try {
      if (action === 'reviewed') {
        await markReviewedMutation.mutateAsync({ id: selectedRecordId });
        toast.success('已标记为复核');
      } else if (action === 'cleared') {
        await clearMutation.mutateAsync({ id: selectedRecordId });
        toast.success('已解除该条审计记录');
      } else {
        await recommendBanMutation.mutateAsync({ id: selectedRecordId });
        toast.success('已记录封禁建议，未直接封禁用户');
      }
      await refreshModeration();
    } catch {
      setModerationError('处置失败，请重试');
      toast.error('处置失败，请重试');
    } finally {
      dispositionInFlightRef.current = false;
      setActiveDisposition(null);
    }
  };

  const isMutating =
    activeDisposition !== null ||
    markReviewedMutation.isPending ||
    clearMutation.isPending ||
    recommendBanMutation.isPending;

  return (
    <Block padding={20} variant={'outlined'}>
      <Flexbox gap={16}>
        <Flexbox gap={6}>
          <Flexbox horizontal align={'center'} gap={8}>
            <ShieldAlert size={20} />
            <Text as={'h3'} weight={600}>
              {'敏感信息审计'}
            </Text>
          </Flexbox>
          <Text color={'secondary'}>
            {
              '列表仅显示审计结论和分类；选中记录后才读取脱敏预览。不显示指纹、原文、提示词、模型或密钥。'
            }
          </Text>
        </Flexbox>

        <Flexbox horizontal align={'end'} gap={10} wrap={'wrap'}>
          <Flexbox gap={6} style={{ flex: '1 1 240px' }}>
            <Text as={'label'} fontSize={12} weight={500}>
              {'审计用户 ID'}
            </Text>
            <Input
              aria-label={'审计用户 ID'}
              placeholder={'留空查看全部用户'}
              value={userIdInput}
              onChange={(event) => setUserIdInput(event.currentTarget.value)}
            />
          </Flexbox>
          <Flexbox gap={6} style={{ flex: '1 1 180px' }}>
            <Text as={'label'} fontSize={12} weight={500}>
              {'处置状态'}
            </Text>
            <Select
              aria-label={'处置状态'}
              placeholder={'全部处置状态'}
              value={dispositionInput}
              options={[
                { label: '全部处置状态', value: '' },
                { label: '待处理', value: 'pending' },
                { label: '已复核', value: 'reviewed' },
                { label: '已解除', value: 'cleared' },
                { label: '已建议封禁', value: 'ban_recommended' },
              ]}
              onChange={(value) =>
                setDispositionInput(value as '' | ModerationRecord['disposition'])
              }
            />
          </Flexbox>
          <Flexbox gap={6} style={{ flex: '1 1 180px' }}>
            <Text as={'label'} fontSize={12} weight={500}>
              {'检测结论'}
            </Text>
            <Select
              aria-label={'检测结论'}
              placeholder={'全部检测结论'}
              value={verdictInput}
              options={[
                { label: '全部检测结论', value: '' },
                { label: '通过', value: 'allow' },
                { label: '待人工审核', value: 'review' },
                { label: '拦截', value: 'block' },
              ]}
              onChange={(value) => setVerdictInput(value as '' | ModerationRecord['verdict'])}
            />
          </Flexbox>
          <Button onClick={applyFilters}>{'应用审计筛选'}</Button>
        </Flexbox>

        {recordsQuery.error ? (
          <Alert title={'审计列表暂时无法读取'} />
        ) : recordsQuery.isLoading ? (
          <Text color={'secondary'}>{'正在读取审计记录…'}</Text>
        ) : records.length === 0 ? (
          <Text color={'secondary'}>{'暂无匹配的审计记录'}</Text>
        ) : (
          <Flexbox gap={10}>
            {records.map((record) => (
              <Block key={record.id} padding={14} variant={'outlined'}>
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={12}
                  justify={'space-between'}
                  wrap={'wrap'}
                >
                  <Flexbox gap={5} style={{ flex: '1 1 460px' }}>
                    <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                      <Text weight={600}>{moderationSourceLabel(record.sourceType)}</Text>
                      <Tag color={record.verdict === 'block' ? 'red' : 'gold'}>
                        {moderationVerdictLabel(record.verdict)}
                      </Tag>
                      <Tag>{moderationDispositionLabel(record.disposition)}</Tag>
                    </Flexbox>
                    <Text color={'secondary'}>{`用户 ID：${record.userId}`}</Text>
                    <Flexbox horizontal gap={6} wrap={'wrap'}>
                      {record.categories.map((finding) => (
                        <Tag key={`${finding.category}-${finding.severity}`}>
                          {`${moderationCategoryLabel(finding.category)} · ${finding.severity} · ${finding.count}`}
                        </Tag>
                      ))}
                    </Flexbox>
                    <Text color={'secondary'}>{`检测时间：${formatDate(record.detectedAt)}`}</Text>
                  </Flexbox>
                  <Button
                    onClick={() => {
                      setModerationError('');
                      setSelectedRecordId(record.id);
                    }}
                  >
                    {'查看审计详情'}
                  </Button>
                </Flexbox>
              </Block>
            ))}
          </Flexbox>
        )}

        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Text color={'secondary'}>{`共 ${total} 条审计记录`}</Text>
          <Flexbox horizontal gap={8}>
            <Button
              disabled={offset === 0}
              onClick={() => {
                setSelectedRecordId('');
                setOffset(Math.max(0, offset - MODERATION_PAGE_SIZE));
              }}
            >
              {'审计上一页'}
            </Button>
            <Button
              disabled={offset + records.length >= total}
              onClick={() => {
                setSelectedRecordId('');
                setOffset(offset + MODERATION_PAGE_SIZE);
              }}
            >
              {'审计下一页'}
            </Button>
          </Flexbox>
        </Flexbox>

        {selectedRecordId && (
          <Block padding={16} variant={'outlined'}>
            <Flexbox gap={10}>
              <Text weight={600}>{'脱敏审计详情'}</Text>
              {detailQuery.error ? (
                <Alert title={'审计详情暂时无法读取'} />
              ) : detailQuery.isLoading || !detailQuery.data ? (
                <Text color={'secondary'}>{'正在读取脱敏预览…'}</Text>
              ) : (
                <>
                  <Block padding={12} variant={'outlined'}>
                    <Text>{detailQuery.data.redactedPreview || '无可展示的脱敏预览'}</Text>
                  </Block>
                  <Text color={'secondary'}>{'封禁建议只记录处置建议，不会直接封禁用户。'}</Text>
                  {moderationError && <Alert title={moderationError} />}
                  <Flexbox horizontal gap={8} wrap={'wrap'}>
                    <Button
                      disabled={isMutating}
                      loading={activeDisposition === 'reviewed' || markReviewedMutation.isPending}
                      onClick={() => setDisposition('reviewed')}
                    >
                      {'标记已复核'}
                    </Button>
                    <Button
                      disabled={isMutating}
                      loading={activeDisposition === 'cleared' || clearMutation.isPending}
                      onClick={() => setDisposition('cleared')}
                    >
                      {'解除记录'}
                    </Button>
                    <Button
                      disabled={isMutating}
                      loading={
                        activeDisposition === 'ban_recommended' || recommendBanMutation.isPending
                      }
                      onClick={() => setDisposition('ban_recommended')}
                    >
                      {'提出封禁建议'}
                    </Button>
                  </Flexbox>
                </>
              )}
            </Flexbox>
          </Block>
        )}
      </Flexbox>
    </Block>
  );
};

const UserAccountControls = ({
  onChanged,
  user,
}: {
  onChanged: () => Promise<void>;
  user: UserRow;
}) => {
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const [fullName, setFullName] = useState(user.fullName || '');
  const [avatar, setAvatar] = useState(user.avatar || '');
  const [confirmation, setConfirmation] = useState<'profile' | 'reset' | null>(null);
  const [activeAction, setActiveAction] = useState<'profile' | 'reset' | null>(null);
  const [error, setError] = useState('');
  const actionInFlightRef = useRef(false);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();

  const updateProfileMutation = lambdaQuery.platformOperations.updateUserProfile.useMutation();
  const forcePasswordResetMutation =
    lambdaQuery.platformOperations.forceUserPasswordReset.useMutation();
  const isCurrentAdministrator = Boolean(currentUserId) && currentUserId === user.id;
  const isMutating =
    activeAction !== null ||
    updateProfileMutation.isPending ||
    forcePasswordResetMutation.isPending;

  const refreshAfterSuccess = async () => {
    try {
      await onChanged();
    } catch {
      toast.error('操作已成功，但用户摘要刷新失败，请手动刷新页面');
    }
  };

  const submitProfile = async () => {
    if (actionInFlightRef.current || isCurrentAdministrator) return;
    const nextFullName = fullName.trim();
    if (!nextFullName) {
      setConfirmation(null);
      setError('用户显示名称不能为空');
      return;
    }

    actionInFlightRef.current = true;
    setActiveAction('profile');
    setError('');
    try {
      await updateProfileMutation.mutateAsync({
        avatar: avatar.trim() || null,
        fullName: nextFullName,
        targetUserId: user.id,
      });
      setConfirmation(null);
      toast.success('用户资料已更新，该用户需重新登录');
      await refreshAfterSuccess();
    } catch {
      setError('用户资料未安全更新，请重试');
      toast.error('用户资料未安全更新，请重试');
    } finally {
      actionInFlightRef.current = false;
      setActiveAction(null);
    }
  };

  const submitPasswordReset = async () => {
    if (actionInFlightRef.current || isCurrentAdministrator) return;
    actionInFlightRef.current = true;
    setActiveAction('reset');
    setError('');
    try {
      await forcePasswordResetMutation.mutateAsync({ targetUserId: user.id });
      setConfirmation(null);
      toast.success('密码重置邮件已发送，该用户已退出全部设备');
      await refreshAfterSuccess();
    } catch {
      setError('密码重置未安全完成，请重试');
      toast.error('密码重置未安全完成，请重试');
    } finally {
      actionInFlightRef.current = false;
      setActiveAction(null);
    }
  };

  if (!currentUserId) {
    return <Alert title={'当前管理员身份暂时无法确认，不允许修改账号资料'} />;
  }

  return (
    <Block padding={20} variant={'outlined'}>
      <Flexbox gap={14}>
        <Flexbox horizontal align={'center'} gap={8}>
          <UserRoundCog size={18} />
          <Text weight={600}>{'账号资料与安全'}</Text>
        </Flexbox>
        <Text color={'secondary'}>
          {'管理员不能查看或指定用户密码。资料更新和强制重置都会退出该用户的全部设备。'}
        </Text>

        {isCurrentAdministrator ? (
          <Alert title={'当前管理员请在个人中心修改自己的资料和密码'} />
        ) : (
          <>
            <Flexbox horizontal gap={16} wrap={'wrap'}>
              <Flexbox gap={10} style={{ flex: '1 1 260px' }}>
                <Field label={'用户显示名称'}>
                  <Input
                    aria-label={'用户显示名称'}
                    maxLength={100}
                    value={fullName}
                    onChange={(event) => setFullName(event.currentTarget.value)}
                  />
                </Field>
                <Field label={'用户头像 URL'}>
                  <Input
                    aria-label={'用户头像 URL'}
                    maxLength={2048}
                    placeholder={'https://... （留空可清除）'}
                    value={avatar}
                    onChange={(event) => setAvatar(event.currentTarget.value)}
                  />
                </Field>
                <Button
                  disabled={isMutating}
                  onClick={() => {
                    setConfirmation('profile');
                    setError('');
                  }}
                >
                  {'保存用户资料'}
                </Button>
              </Flexbox>

              <Flexbox gap={10} style={{ flex: '1 1 260px' }}>
                <Flexbox horizontal align={'center'} gap={6}>
                  <KeyRound size={16} />
                  <Text weight={600}>{'强制密码重置'}</Text>
                </Flexbox>
                <Text color={'secondary'}>
                  {'系统向用户邮箱发送旅游群网一次性重置链接，同时废止旧密码和全部现有会话。'}
                </Text>
                <Button
                  disabled={isMutating}
                  onClick={() => {
                    setConfirmation('reset');
                    setError('');
                  }}
                >
                  {'强制密码重置'}
                </Button>
              </Flexbox>
            </Flexbox>

            {confirmation && (
              <Flexbox
                aria-describedby={dialogDescriptionId}
                aria-labelledby={dialogTitleId}
                gap={10}
                role={'alertdialog'}
              >
                <Text id={dialogTitleId} weight={600}>
                  {confirmation === 'profile' ? '确认修改该用户资料？' : '确认强制该用户重置密码？'}
                </Text>
                <Text color={'secondary'} id={dialogDescriptionId}>
                  {confirmation === 'profile'
                    ? '保存后，该用户全部设备需重新登录。'
                    : '发送一次性重置链接后，旧密码和全部现有会话将失效。'}
                </Text>
                <Flexbox horizontal gap={8} wrap={'wrap'}>
                  <Button autoFocus disabled={isMutating} onClick={() => setConfirmation(null)}>
                    {'取消'}
                  </Button>
                  <Button
                    disabled={isMutating}
                    loading={
                      confirmation === 'profile'
                        ? activeAction === 'profile' || updateProfileMutation.isPending
                        : activeAction === 'reset' || forcePasswordResetMutation.isPending
                    }
                    onClick={confirmation === 'profile' ? submitProfile : submitPasswordReset}
                  >
                    {confirmation === 'profile'
                      ? '确认保存并退出该用户设备'
                      : '发送重置链接并退出该用户设备'}
                  </Button>
                </Flexbox>
              </Flexbox>
            )}
            {error && <Alert title={error} />}
          </>
        )}
      </Flexbox>
    </Block>
  );
};

const UserBanControls = ({
  onChanged,
  user,
}: {
  onChanged: () => Promise<void>;
  user: UserRow;
}) => {
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const [confirmation, setConfirmation] = useState<'ban' | 'unban' | null>(null);
  const [activeAction, setActiveAction] = useState<'ban' | 'unban' | null>(null);
  const [reason, setReason] = useState('');
  const [banExpires, setBanExpires] = useState('');
  const [error, setError] = useState('');
  const actionInFlightRef = useRef(false);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();

  const banMutation = lambdaQuery.platformOperations.banUser.useMutation();
  const unbanMutation = lambdaQuery.platformOperations.unbanUser.useMutation();
  const isMutating = activeAction !== null || banMutation.isPending || unbanMutation.isPending;
  const isCurrentAdministrator = Boolean(currentUserId) && currentUserId === user.id;

  const refreshAfterSuccess = async () => {
    try {
      await onChanged();
    } catch {
      toast.error('操作已成功，但用户摘要刷新失败，请手动刷新页面');
    }
  };

  const submitBan = async () => {
    if (actionInFlightRef.current) return;
    if (isCurrentAdministrator) {
      setError('不能封禁当前管理员账号');
      return;
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError('请填写封禁理由');
      return;
    }
    if (containsSensitiveBanReason(trimmedReason)) {
      setError('封禁理由不得包含密钥或联系方式等敏感信息');
      return;
    }

    let expiresAt: Date | undefined;
    if (banExpires) {
      try {
        expiresAt = parseLocalBanExpiry(banExpires);
      } catch (validationError) {
        setError(
          validationError instanceof OperationValidationError
            ? validationError.message
            : '封禁到期时间必须是有效的未来本地时间',
        );
        return;
      }
    }

    actionInFlightRef.current = true;
    setActiveAction('ban');
    setError('');
    try {
      await banMutation.mutateAsync({
        ...(expiresAt ? { banExpires: expiresAt } : {}),
        reason: trimmedReason,
        targetUserId: user.id,
      });
      setConfirmation(null);
      setReason('');
      setBanExpires('');
      toast.success('用户已封禁');
      await refreshAfterSuccess();
    } catch {
      setError('封禁失败，请重试');
      toast.error('封禁失败，请重试');
    } finally {
      actionInFlightRef.current = false;
      setActiveAction(null);
    }
  };

  const submitUnban = async () => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setActiveAction('unban');
    setError('');
    try {
      await unbanMutation.mutateAsync({ targetUserId: user.id });
      setConfirmation(null);
      toast.success('已解除用户封禁');
      await refreshAfterSuccess();
    } catch {
      setError('解除封禁失败，请重试');
      toast.error('解除封禁失败，请重试');
    } finally {
      actionInFlightRef.current = false;
      setActiveAction(null);
    }
  };

  if (!currentUserId) {
    return <Alert title={'当前管理员身份暂时无法确认，不允许变更封禁状态'} />;
  }

  return (
    <Block padding={20} variant={'outlined'}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Ban size={18} />
          <Text weight={600}>{'账号封禁管理'}</Text>
        </Flexbox>

        {isCurrentAdministrator && !user.banned ? (
          <Text color={'secondary'}>{'不能封禁当前管理员账号'}</Text>
        ) : user.banned ? (
          confirmation === 'unban' ? (
            <Flexbox
              aria-describedby={dialogDescriptionId}
              aria-labelledby={dialogTitleId}
              gap={10}
              role={'alertdialog'}
            >
              <Text id={dialogTitleId} weight={600}>
                {'确认解除该用户的封禁状态？'}
              </Text>
              <Text color={'secondary'} id={dialogDescriptionId}>
                {'解除后，该用户将恢复访问平台。'}
              </Text>
              {error && <Alert title={error} />}
              <Flexbox horizontal gap={8} wrap={'wrap'}>
                <Button
                  autoFocus
                  disabled={isMutating}
                  onClick={() => {
                    setConfirmation(null);
                    setError('');
                  }}
                >
                  {'取消'}
                </Button>
                <Button
                  disabled={isMutating}
                  loading={activeAction === 'unban' || unbanMutation.isPending}
                  onClick={submitUnban}
                >
                  {'确认解除封禁'}
                </Button>
              </Flexbox>
            </Flexbox>
          ) : (
            <Button
              disabled={isMutating}
              onClick={() => {
                setConfirmation('unban');
                setError('');
              }}
            >
              {'解除封禁'}
            </Button>
          )
        ) : confirmation === 'ban' ? (
          <Flexbox
            aria-describedby={dialogDescriptionId}
            aria-labelledby={dialogTitleId}
            gap={12}
            role={'alertdialog'}
          >
            <Text id={dialogTitleId} weight={600}>
              {'确认封禁该用户？'}
            </Text>
            <Text color={'secondary'} id={dialogDescriptionId}>
              {
                '封禁后用户将无法继续使用平台。客户端仅辅助检查常见敏感信息，理由仍只能记录最小必要的处置依据。'
              }
            </Text>
            <Field label={'封禁理由'}>
              <TextArea
                aria-label={'封禁理由'}
                autoSize={{ minRows: 2 }}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </Field>
            <Field label={'封禁到期时间（可选）'}>
              <Input
                aria-label={'封禁到期时间'}
                type={'datetime-local'}
                value={banExpires}
                onChange={(event) => setBanExpires(event.currentTarget.value)}
              />
            </Field>
            <Text color={'secondary'} fontSize={12}>
              {'按当前设备本地时区填写，提交时转为同一时刻。'}
            </Text>
            {error && <Alert title={error} />}
            <Flexbox horizontal gap={8} wrap={'wrap'}>
              <Button
                autoFocus
                disabled={isMutating}
                onClick={() => {
                  setConfirmation(null);
                  setError('');
                }}
              >
                {'取消'}
              </Button>
              <Button
                danger
                disabled={isMutating}
                loading={activeAction === 'ban' || banMutation.isPending}
                onClick={submitBan}
              >
                {'确认封禁用户'}
              </Button>
            </Flexbox>
          </Flexbox>
        ) : (
          <Button
            danger
            disabled={isMutating}
            onClick={() => {
              setConfirmation('ban');
              setError('');
            }}
          >
            {'封禁用户'}
          </Button>
        )}
      </Flexbox>
    </Block>
  );
};

const ServiceOperations = () => {
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [summaryRevision, setSummaryRevision] = useState(0);
  const [topUpCredits, setTopUpCredits] = useState('');
  const [topUpReason, setTopUpReason] = useState('');
  const [adjustmentCredits, setAdjustmentCredits] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [reversalEntryId, setReversalEntryId] = useState('');
  const [reversalReason, setReversalReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [contentFilterInputs, setContentFilterInputs] = useState(createContentCatalogFilters);
  const [contentFilters, setContentFilters] = useState(createContentCatalogFilters);
  const [contentPagination, setContentPagination] = useState(() =>
    createContentCatalogPagination(''),
  );

  const topUpRetryKey = useRef<RetryKey | null>(null);
  const adjustmentRetryKey = useRef<RetryKey | null>(null);
  const reversalRetryKey = useRef<RetryKey | null>(null);

  const usersQuery = lambdaQuery.platformOperations.listUsers.useQuery({
    limit: PAGE_SIZE,
    offset,
    query: query || undefined,
  });
  const users = usersQuery.data?.items ?? EMPTY_USERS;
  const total = usersQuery.data?.total ?? 0;
  const userSummariesQuery = lambdaQuery.platformOperations.getUserSummaries.useQuery(
    { userIds: users.map(({ id }) => id) },
    { enabled: users.length > 0, retry: false },
  );
  const summaries = Object.fromEntries(
    (userSummariesQuery.data?.items ?? []).map((summary) => [summary.userId, summary]),
  ) as Record<string, UserSummary>;
  const selectedUser = users.find((user) => user.id === selectedUserId);
  const getContentPagination = (kind: ContentCatalogKind) => {
    const pagination = contentPagination[kind];
    return pagination.userId === selectedUserId
      ? pagination
      : { cursors: [undefined], pageIndex: 0, userId: selectedUserId };
  };
  const generationContentPagination = getContentPagination('generation');
  const workContentPagination = getContentPagination('work');
  const documentContentPagination = getContentPagination('document');

  const accountQuery = lambdaQuery.platformCredit.getUserAccount.useQuery(
    { targetUserId: selectedUserId },
    { enabled: Boolean(selectedUserId), retry: false },
  );
  const entriesQuery = lambdaQuery.platformCredit.listUserEntries.useQuery(
    { limit: CREDIT_ENTRIES_LIMIT, targetUserId: selectedUserId },
    { enabled: Boolean(selectedUserId), retry: false },
  );
  const overviewQuery = lambdaQuery.platformOperations.getUserOverview.useQuery(
    { recentLimit: RECENT_LIMIT, userId: selectedUserId },
    { enabled: Boolean(selectedUserId), retry: false },
  );
  const generationCatalogQuery = lambdaQuery.platformOperations.getUserContentCatalog.useQuery(
    {
      ...(generationContentPagination.cursors[generationContentPagination.pageIndex]
        ? { cursor: generationContentPagination.cursors[generationContentPagination.pageIndex] }
        : {}),
      ...(contentFilters.generation.endDate
        ? { endAt: new Date(`${contentFilters.generation.endDate}T23:59:59.999Z`) }
        : {}),
      kind: 'generation',
      limit: CONTENT_CATALOG_LIMIT,
      ...(contentFilters.generation.startDate
        ? { startAt: new Date(`${contentFilters.generation.startDate}T00:00:00.000Z`) }
        : {}),
      ...(contentFilters.generation.status ? { status: contentFilters.generation.status } : {}),
      targetUserId: selectedUserId,
      ...(contentFilters.generation.type ? { type: contentFilters.generation.type } : {}),
    },
    { enabled: Boolean(selectedUserId), retry: false },
  );
  const workCatalogQuery = lambdaQuery.platformOperations.getUserContentCatalog.useQuery(
    {
      ...(workContentPagination.cursors[workContentPagination.pageIndex]
        ? { cursor: workContentPagination.cursors[workContentPagination.pageIndex] }
        : {}),
      ...(contentFilters.work.endDate
        ? { endAt: new Date(`${contentFilters.work.endDate}T23:59:59.999Z`) }
        : {}),
      kind: 'work',
      limit: CONTENT_CATALOG_LIMIT,
      ...(contentFilters.work.startDate
        ? { startAt: new Date(`${contentFilters.work.startDate}T00:00:00.000Z`) }
        : {}),
      ...(contentFilters.work.status ? { status: contentFilters.work.status } : {}),
      targetUserId: selectedUserId,
      ...(contentFilters.work.type ? { type: contentFilters.work.type } : {}),
    },
    { enabled: Boolean(selectedUserId), retry: false },
  );
  const documentCatalogQuery = lambdaQuery.platformOperations.getUserContentCatalog.useQuery(
    {
      ...(documentContentPagination.cursors[documentContentPagination.pageIndex]
        ? { cursor: documentContentPagination.cursors[documentContentPagination.pageIndex] }
        : {}),
      ...(contentFilters.document.endDate
        ? { endAt: new Date(`${contentFilters.document.endDate}T23:59:59.999Z`) }
        : {}),
      kind: 'document',
      limit: CONTENT_CATALOG_LIMIT,
      ...(contentFilters.document.startDate
        ? { startAt: new Date(`${contentFilters.document.startDate}T00:00:00.000Z`) }
        : {}),
      targetUserId: selectedUserId,
      ...(contentFilters.document.type ? { type: contentFilters.document.type } : {}),
    },
    { enabled: Boolean(selectedUserId), retry: false },
  );
  const sessionOverviewQuery = lambdaQuery.platformOperations.getUserSessionOverview.useQuery(
    { limit: 10, targetUserId: selectedUserId },
    { enabled: Boolean(selectedUserId), retry: false },
  );
  const travelGroupHealthQuery =
    lambdaQuery.platformOperations.getUserTravelGroupHealthOverview.useQuery(
      { targetUserId: selectedUserId },
      { enabled: Boolean(selectedUserId), retry: false },
    );
  const adminAuditQuery = lambdaQuery.platformOperations.listAuditEvents.useQuery(
    { limit: 10, targetUserId: selectedUserId },
    { enabled: Boolean(selectedUserId), retry: false },
  );

  const topUpMutation = lambdaQuery.platformCredit.topUp.useMutation();
  const adjustmentMutation = lambdaQuery.platformCredit.adjust.useMutation();
  const reversalMutation = lambdaQuery.platformCredit.reverse.useMutation();

  useEffect(() => {
    if (users.length === 0) {
      setSelectedUserId('');
      return;
    }
    if (!users.some((user) => user.id === selectedUserId)) setSelectedUserId(users[0].id);
  }, [selectedUserId, users]);

  useEffect(() => {
    setContentPagination(createContentCatalogPagination(selectedUserId));
    setTopUpCredits('');
    setTopUpReason('');
    setAdjustmentCredits('');
    setAdjustmentReason('');
    setReversalEntryId('');
    setReversalReason('');
    setActionError('');
    topUpRetryKey.current = null;
    adjustmentRetryKey.current = null;
    reversalRetryKey.current = null;
  }, [selectedUserId]);

  const entries = entriesQuery.data ?? [];
  const reversedEntryIds = new Set(
    entries.flatMap((entry) => (entry.reversalOfEntryId ? [entry.reversalOfEntryId] : [])),
  );
  const reversibleEntries = entries.filter(
    (entry) => entry.type !== 'reversal' && !reversedEntryIds.has(entry.id),
  );

  useEffect(() => {
    if (!reversibleEntries.some((entry) => entry.id === reversalEntryId)) {
      setReversalEntryId(reversibleEntries[0]?.id ?? '');
    }
  }, [reversalEntryId, reversibleEntries]);

  const updateContentFilterInput = (
    kind: ContentCatalogKind,
    field: keyof ContentCatalogFilters,
    value: string,
  ) => {
    setContentFilterInputs((current) => ({
      ...current,
      [kind]: { ...current[kind], [field]: value },
    }));
  };

  const applyContentFilters = (kind: ContentCatalogKind) => {
    setContentFilters((current) => ({
      ...current,
      [kind]: {
        ...contentFilterInputs[kind],
        status: contentFilterInputs[kind].status.trim(),
        type: contentFilterInputs[kind].type.trim(),
      },
    }));
    setContentPagination((current) => ({
      ...current,
      [kind]: { cursors: [undefined], pageIndex: 0, userId: selectedUserId },
    }));
  };

  const showPreviousContentPage = (kind: ContentCatalogKind) => {
    setContentPagination((current) => {
      const pagination =
        current[kind].userId === selectedUserId
          ? current[kind]
          : { cursors: [undefined], pageIndex: 0, userId: selectedUserId };
      return {
        ...current,
        [kind]: { ...pagination, pageIndex: Math.max(0, pagination.pageIndex - 1) },
      };
    });
  };

  const showNextContentPage = (kind: ContentCatalogKind, cursor: string) => {
    setContentPagination((current) => {
      const pagination =
        current[kind].userId === selectedUserId
          ? current[kind]
          : { cursors: [undefined], pageIndex: 0, userId: selectedUserId };
      return {
        ...current,
        [kind]: {
          cursors: [...pagination.cursors.slice(0, pagination.pageIndex + 1), cursor],
          pageIndex: pagination.pageIndex + 1,
          userId: selectedUserId,
        },
      };
    });
  };

  const retryContentCatalog = (kind: ContentCatalogKind) => {
    const queryByKind = {
      document: documentCatalogQuery,
      generation: generationCatalogQuery,
      work: workCatalogQuery,
    };
    void queryByKind[kind].refetch();
  };

  const refreshSelectedUser = async () => {
    const refreshResults = await Promise.allSettled([
      usersQuery.refetch(),
      userSummariesQuery.refetch(),
      accountQuery.refetch(),
      entriesQuery.refetch(),
      overviewQuery.refetch(),
      generationCatalogQuery.refetch(),
      workCatalogQuery.refetch(),
      documentCatalogQuery.refetch(),
      sessionOverviewQuery.refetch(),
      travelGroupHealthQuery.refetch(),
      adminAuditQuery.refetch(),
    ]);
    setSummaryRevision((value) => value + 1);
    if (refreshResults.some((result) => result.status === 'rejected')) {
      throw new Error('user-summary-refresh-failed');
    }
  };

  const finishSuccessfulMutation = async (message: string) => {
    toast.success(message);
    try {
      await refreshSelectedUser();
    } catch {
      toast.error('操作已成功，但最新数据刷新失败，请手动刷新页面');
    }
  };

  const validateReason = (reason: string) => {
    const trimmed = reason.trim();
    if (!trimmed) throw new OperationValidationError('请填写操作理由');
    return trimmed;
  };

  const submitTopUp = async () => {
    try {
      if (!selectedUserId) throw new OperationValidationError('请先选择用户');
      const credits = parseCredits(topUpCredits, true);
      const reason = validateReason(topUpReason);
      const signature = `${selectedUserId}\0${credits}\0${reason}`;
      const idempotencyKey = resolveRetryKey(topUpRetryKey, 'top-up', signature);
      setActionError('');
      await topUpMutation.mutateAsync({
        credits,
        idempotencyKey,
        reason,
        targetUserId: selectedUserId,
      });
      topUpRetryKey.current = null;
      setTopUpCredits('');
      setTopUpReason('');
      await finishSuccessfulMutation('充值已记入 Credits 流水');
    } catch (error) {
      const message =
        error instanceof OperationValidationError ? error.message : '充值失败，请重试';
      setActionError(message);
      toast.error(message);
    }
  };

  const submitAdjustment = async () => {
    try {
      if (!selectedUserId) throw new OperationValidationError('请先选择用户');
      const credits = parseCredits(adjustmentCredits, false);
      const reason = validateReason(adjustmentReason);
      const signature = `${selectedUserId}\0${credits}\0${reason}`;
      const idempotencyKey = resolveRetryKey(adjustmentRetryKey, 'adjust', signature);
      setActionError('');
      await adjustmentMutation.mutateAsync({
        credits,
        idempotencyKey,
        reason,
        targetUserId: selectedUserId,
      });
      adjustmentRetryKey.current = null;
      setAdjustmentCredits('');
      setAdjustmentReason('');
      await finishSuccessfulMutation('Credits 余额已调整');
    } catch (error) {
      const message =
        error instanceof OperationValidationError ? error.message : '调整失败，请重试';
      setActionError(message);
      toast.error(message);
    }
  };

  const submitReversal = async () => {
    try {
      if (!reversalEntryId) throw new OperationValidationError('请选择可冲正流水');
      const reason = validateReason(reversalReason);
      const signature = `${reversalEntryId}\0${reason}`;
      const idempotencyKey = resolveRetryKey(reversalRetryKey, 'reversal', signature);
      setActionError('');
      await reversalMutation.mutateAsync({ entryId: reversalEntryId, idempotencyKey, reason });
      reversalRetryKey.current = null;
      setReversalReason('');
      await finishSuccessfulMutation('流水已冲正');
    } catch (error) {
      const message =
        error instanceof OperationValidationError ? error.message : '冲正失败，请重试';
      setActionError(message);
      toast.error(message);
    }
  };

  const runSearch = () => {
    setOffset(0);
    setQuery(searchInput.trim());
  };

  return (
    <Flexbox gap={20}>
      <Flexbox gap={6}>
        <Flexbox horizontal align={'center'} gap={10}>
          <Users size={24} />
          <Text as={'h2'} weight={600}>
            {'平台用户运营'}
          </Text>
        </Flexbox>
        <Text color={'secondary'}>
          {
            '仅平台管理员可用；用户资料、Credits 和旅行服务账本分区展示。本页不读取模型、密钥、提示词或生成正文。'
          }
        </Text>
      </Flexbox>

      <Block padding={20} variant={'outlined'}>
        <Flexbox gap={16}>
          <Flexbox horizontal align={'end'} gap={8} wrap={'wrap'}>
            <Flexbox gap={6} style={{ flex: '1 1 280px' }}>
              <Text as={'label'} fontSize={12} weight={500}>
                {'搜索用户'}
              </Text>
              <Input
                aria-label={'搜索用户'}
                placeholder={'姓名、用户名、邮箱或用户 ID'}
                value={searchInput}
                onChange={(event) => setSearchInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') runSearch();
                }}
              />
            </Flexbox>
            <Button icon={<Search size={16} />} onClick={runSearch}>
              {'搜索'}
            </Button>
          </Flexbox>

          {usersQuery.error ? (
            <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
              <Alert title={'用户列表暂时无法读取'} />
              <Button onClick={() => void usersQuery.refetch()}>{'重试用户列表'}</Button>
            </Flexbox>
          ) : usersQuery.isLoading ? (
            <Text color={'secondary'}>{'正在读取用户…'}</Text>
          ) : users.length === 0 ? (
            <Text color={'secondary'}>{'没有匹配的用户'}</Text>
          ) : (
            <Flexbox gap={10}>
              {users.map((user) => {
                const summary = summaries[user.id];
                const displayName = user.fullName || user.username || user.email || user.id;
                return (
                  <Block key={user.id} padding={16} variant={'outlined'}>
                    <Flexbox
                      horizontal
                      align={'center'}
                      gap={16}
                      justify={'space-between'}
                      wrap={'wrap'}
                    >
                      <Flexbox gap={5} style={{ flex: '1 1 280px' }}>
                        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                          <Text weight={600}>{displayName}</Text>
                          <Tag color={user.banned ? 'red' : 'green'}>
                            {user.banned ? '已封禁' : '正常'}
                          </Tag>
                          <Tag>{groupStatusLabel(summary?.groupReadiness)}</Tag>
                          <Tag>{`生成 ${summary?.generationTotal ?? '—'} 项`}</Tag>
                        </Flexbox>
                        <Text color={'secondary'}>{user.email || '未填写邮箱'}</Text>
                        <Text
                          color={'secondary'}
                        >{`最近会话 IP：${user.latestSessionIp || '无'}`}</Text>
                        <Text
                          color={'secondary'}
                        >{`最近会话：${formatDate(user.latestSessionAt)}`}</Text>
                        {user.banned && (
                          <Text color={'secondary'}>
                            {`封禁原因：${formatBanReasonForDisplay(user.banReason)}；到期：${formatDate(user.banExpires)}`}
                          </Text>
                        )}
                      </Flexbox>

                      <Flexbox gap={8} style={{ flex: '0 1 300px' }}>
                        <Flexbox horizontal align={'center'} gap={8}>
                          <Coins size={16} />
                          <Text weight={600}>{formatCredits(summary?.balanceCredits)}</Text>
                        </Flexbox>
                        <Text weight={600}>{'旅行服务账本（CNY）'}</Text>
                        <Text>{formatCnyFen(user.travelServiceLedger.balanceFen)}</Text>
                        <Text color={'secondary'}>
                          {`累计消费 ${formatCnyFen(user.travelServiceLedger.totalConsumptionFen)}`}
                        </Text>
                      </Flexbox>

                      <Button onClick={() => setSelectedUserId(user.id)}>
                        {selectedUserId === user.id ? '当前用户' : '查看'}
                      </Button>
                    </Flexbox>
                  </Block>
                );
              })}
            </Flexbox>
          )}

          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Text color={'secondary'}>{`共 ${total} 位用户`}</Text>
            <Flexbox horizontal gap={8}>
              <Button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                {'上一页'}
              </Button>
              <Button
                disabled={offset + users.length >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {'下一页'}
              </Button>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </Block>

      {selectedUser && (
        <Flexbox gap={16}>
          <Flexbox horizontal align={'center'} gap={8}>
            <CheckCircle2 size={20} />
            <Text as={'h3'} weight={600}>{`用户详情：${
              selectedUser.fullName ||
              selectedUser.username ||
              selectedUser.email ||
              selectedUser.id
            }`}</Text>
          </Flexbox>

          <Flexbox horizontal gap={12} wrap={'wrap'}>
            <Metric
              label={'Credits 账户'}
              value={`当前余额 ${formatCredits(accountQuery.data?.balanceCredits)}`}
            />
            <Metric
              label={'私人超级群组'}
              value={
                overviewQuery.data
                  ? `群组状态：${groupStatusLabel(overviewQuery.data.travelGroup.readiness).replace('群组', '')}`
                  : '读取中'
              }
            />
            <Metric
              label={'生成管理'}
              value={
                overviewQuery.data ? `已记录 ${overviewQuery.data.generation.total} 项` : '读取中'
              }
            />
          </Flexbox>

          {(accountQuery.error || entriesQuery.error || overviewQuery.error) && (
            <Alert title={'部分用户运营数据暂时无法读取'} />
          )}
          {actionError && <Alert title={actionError} />}

          <UserAccountControls
            key={`account-${selectedUser.id}`}
            user={selectedUser}
            onChanged={refreshSelectedUser}
          />

          <UserBanControls
            key={`${selectedUser.id}-${selectedUser.banned}`}
            user={selectedUser}
            onChanged={refreshSelectedUser}
          />

          <UserAdminAuditSection
            error={adminAuditQuery.error}
            events={adminAuditQuery.data?.items ?? EMPTY_ADMIN_AUDIT_EVENTS}
            loading={adminAuditQuery.isLoading}
          />

          <UserTravelGroupHealthSection
            error={travelGroupHealthQuery.error}
            key={`travel-group-health-${selectedUser.id}`}
            loading={travelGroupHealthQuery.isLoading}
            overview={travelGroupHealthQuery.data}
            targetActive={!selectedUser.banned}
            userId={selectedUser.id}
            onChanged={refreshSelectedUser}
          />

          <UserPrivateGroupsSection
            defaultGroup={overviewQuery.data?.travelGroup}
            key={`private-groups-${selectedUser.id}-${summaryRevision}`}
            userId={selectedUser.id}
          />

          <UserModerationSafetyOverviewSection key={selectedUser.id} userId={selectedUser.id} />

          <UserContentCatalogSection
            filterInputs={contentFilterInputs}
            catalogs={{
              document: documentCatalogQuery.data,
              generation: generationCatalogQuery.data,
              work: workCatalogQuery.data,
            }}
            errors={{
              document: documentCatalogQuery.error,
              generation: generationCatalogQuery.error,
              work: workCatalogQuery.error,
            }}
            loading={{
              document: documentCatalogQuery.isLoading,
              generation: generationCatalogQuery.isLoading,
              work: workCatalogQuery.isLoading,
            }}
            pageIndexes={{
              document: documentContentPagination.pageIndex,
              generation: generationContentPagination.pageIndex,
              work: workContentPagination.pageIndex,
            }}
            onApplyFilters={applyContentFilters}
            onFilterInputChange={updateContentFilterInput}
            onNextPage={showNextContentPage}
            onPreviousPage={showPreviousContentPage}
            onRetry={retryContentCatalog}
          />

          <UserSessionOverviewSection
            error={sessionOverviewQuery.error}
            key={`sessions-${selectedUser.id}`}
            loading={sessionOverviewQuery.isLoading}
            overview={sessionOverviewQuery.data}
            userId={selectedUser.id}
            onChanged={refreshSelectedUser}
          />

          <Block padding={20} variant={'outlined'}>
            <Flexbox gap={12}>
              <Flexbox horizontal align={'center'} gap={8}>
                <FileClock size={18} />
                <Text weight={600}>{'Credits 流水'}</Text>
              </Flexbox>
              {entriesQuery.isLoading ? (
                <Text color={'secondary'}>{'正在读取流水…'}</Text>
              ) : entries.length === 0 ? (
                <Text color={'secondary'}>{'暂无 Credits 流水'}</Text>
              ) : (
                entries.map((entry) => (
                  <Block key={entry.id} padding={12} variant={'outlined'}>
                    <Flexbox
                      horizontal
                      align={'center'}
                      gap={12}
                      justify={'space-between'}
                      wrap={'wrap'}
                    >
                      <Flexbox gap={3}>
                        <Text weight={600}>{entryTypeLabel(entry.type)}</Text>
                        <Text color={'secondary'}>{entry.reason}</Text>
                        <Text color={'secondary'}>{formatDate(entry.createdAt)}</Text>
                      </Flexbox>
                      <Flexbox gap={3} style={{ textAlign: 'right' }}>
                        <Text weight={600}>
                          {`${entry.amountCredits > 0 ? '+' : ''}${new Intl.NumberFormat('zh-CN').format(entry.amountCredits)} Credits`}
                        </Text>
                        <Text color={'secondary'}>
                          {`余额 ${formatCredits(entry.balanceAfterCredits)}`}
                        </Text>
                      </Flexbox>
                    </Flexbox>
                  </Block>
                ))
              )}
            </Flexbox>
          </Block>

          <Block padding={20} variant={'outlined'}>
            <Flexbox gap={16}>
              <Text weight={600}>{'Credits 管理操作'}</Text>
              <Text color={'secondary'}>
                {
                  'Credits 仅接受安全整数，每次操作都必须填写理由并使用幂等键。这些数值不与 CNY 旅行服务账本合并。'
                }
              </Text>
              <Flexbox horizontal gap={20} wrap={'wrap'}>
                <Flexbox gap={12} style={{ flex: '1 1 260px' }}>
                  <Text weight={600}>{'管理员充值'}</Text>
                  <Field label={'充值 Credits'}>
                    <Input
                      aria-label={'充值 Credits'}
                      inputMode={'numeric'}
                      placeholder={'例如：1000000'}
                      value={topUpCredits}
                      onChange={(event) => setTopUpCredits(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={'充值理由'}>
                    <TextArea
                      aria-label={'充值理由'}
                      autoSize={{ minRows: 2 }}
                      maxLength={500}
                      value={topUpReason}
                      onChange={(event) => setTopUpReason(event.currentTarget.value)}
                    />
                  </Field>
                  <Button loading={topUpMutation.isPending} onClick={submitTopUp}>
                    {'确认充值'}
                  </Button>
                </Flexbox>

                <Flexbox gap={12} style={{ flex: '1 1 260px' }}>
                  <Text weight={600}>{'余额调整'}</Text>
                  <Field label={'调整 Credits'}>
                    <Input
                      aria-label={'调整 Credits'}
                      inputMode={'numeric'}
                      placeholder={'正数增加，负数减少'}
                      value={adjustmentCredits}
                      onChange={(event) => setAdjustmentCredits(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={'调整理由'}>
                    <TextArea
                      aria-label={'调整理由'}
                      autoSize={{ minRows: 2 }}
                      maxLength={500}
                      value={adjustmentReason}
                      onChange={(event) => setAdjustmentReason(event.currentTarget.value)}
                    />
                  </Field>
                  <Button loading={adjustmentMutation.isPending} onClick={submitAdjustment}>
                    {'确认调整'}
                  </Button>
                </Flexbox>

                <Flexbox gap={12} style={{ flex: '1 1 260px' }}>
                  <Flexbox horizontal align={'center'} gap={6}>
                    <Ban size={16} />
                    <Text weight={600}>{'冲正流水'}</Text>
                  </Flexbox>
                  <Field label={'冲正流水'}>
                    <Select
                      aria-label={'冲正流水'}
                      disabled={reversibleEntries.length === 0}
                      value={reversalEntryId}
                      options={reversibleEntries.map((entry) => ({
                        label: `${entryTypeLabel(entry.type)} · ${formatCredits(entry.amountCredits)} · ${entry.reason}`,
                        value: entry.id,
                      }))}
                      onChange={setReversalEntryId}
                    />
                  </Field>
                  <Field label={'冲正理由'}>
                    <TextArea
                      aria-label={'冲正理由'}
                      autoSize={{ minRows: 2 }}
                      maxLength={500}
                      value={reversalReason}
                      onChange={(event) => setReversalReason(event.currentTarget.value)}
                    />
                  </Field>
                  <Button
                    disabled={!reversalEntryId}
                    loading={reversalMutation.isPending}
                    onClick={submitReversal}
                  >
                    {'确认冲正'}
                  </Button>
                </Flexbox>
              </Flexbox>
            </Flexbox>
          </Block>
        </Flexbox>
      )}

      <ModerationSection />

      <Block padding={20} variant={'outlined'}>
        <Flexbox gap={8}>
          <Text as={'h3'} weight={600}>
            {'旅行服务账本操作（CNY）'}
          </Text>
          <Text color={'secondary'}>
            {'这是原有的人民币旅行服务账本，独立于上方 Credits 用量账户，两者不合并计算。'}
          </Text>
          <CnyTravelServiceOperationsView />
        </Flexbox>
      </Block>
    </Flexbox>
  );
};

export default ServiceOperations;
