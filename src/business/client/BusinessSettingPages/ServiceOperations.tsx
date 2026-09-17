'use client';

import { Block, Flexbox, Input, TextArea } from '@lobehub/ui';
import { Alert, Button, Modal, Select, Tabs, Tag, Text, toast } from '@lobehub/ui/base-ui';
import type { inferRouterOutputs } from '@trpc/server';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  Ban,
  CalendarDays,
  CheckCircle2,
  CirclePlus,
  ContactRound,
  FileClock,
  FileText,
  Fingerprint,
  Folders,
  Image,
  KeyRound,
  ListChecks,
  LogIn,
  Mail,
  Phone,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  UserRoundCog,
  Users,
  WalletCards,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';
import { lambdaQuery } from '@/libs/trpc/client';
import type { LambdaRouter } from '@/server/routers/lambda';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { getTravelLocale, translateTravel, useTravelTranslation } from '@/utils/i18n/travel';

import AvatarUrlField from './AvatarUrlField';
import ManagedDeleteControl from './ManagedDeleteControl';
import ManagedPasswordControl from './ManagedPasswordControl';
import UserPrivateGroupsSection from './UserPrivateGroupsSection';

const contentStatusLabel = (status: string) =>
  (
    ({
      pending: translateTravel('待处理'),
      processing: translateTravel('处理中'),
      running: translateTravel('运行中'),
      completed: translateTravel('已完成'),
      success: translateTravel('成功'),
      succeeded: translateTravel('成功'),
      failed: translateTravel('失败'),
      error: translateTravel('错误'),
      cancelled: translateTravel('已取消'),
      canceled: translateTravel('已取消'),
      draft: translateTravel('草稿'),
      published: translateTravel('已发布'),
      archived: translateTravel('已归档'),
      active: translateTravel('正常'),
      inactive: translateTravel('未启用'),
      disabled: translateTravel('已停用'),
    }) as Record<string, string>
  )[status] ?? status;

const PAGE_SIZE = 20;
const RECENT_LIMIT = 20;
const CREDIT_ENTRIES_LIMIT = 100;
const PENDING_RESERVATIONS_LIMIT = 100;
const MODERATION_PAGE_SIZE = 20;
const CONTENT_CATALOG_LIMIT = 5;

const styles = createStaticStyles(({ css }) => ({
  customerPage: css`
    /* 边距统一由 SettingContainer（<768px 为 10px）+ page 的 10px 方案接管，
       这里不再叠加自己的填充（之前的 padding-right/bottom 会把右侧/底部
       变成 18px，与左侧 10px 不对称——用户实测）。 */
    padding: 0;
  `,
  auditPanel: css`
    padding: 0;

    /* The shared settings container supplies the 48px page inset. */
    /* stylelint-disable liberty/use-logical-spec, declaration-block-no-redundant-longhand-properties */
    border-width: 0;
    /* stylelint-enable liberty/use-logical-spec, declaration-block-no-redundant-longhand-properties */
  `,
  page: css`
    container-type: inline-size;

    /* 不能写 width: 100%——它会把宽度钉死在父容器内容宽，下面的负 margin
       只能位移、无法扩宽（834px 实测正文被限成 621px）。去掉后 flex stretch
       会按「容器宽 - 负 margin」计算出真正撑满的宽度。 */
    min-width: 0;
    font-size: 14px;
    line-height: 1.6;

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    input,
    textarea,
    [role='combobox'] {
      min-width: 0;
      max-width: 100%;
    }

    button {
      min-width: 0;
      max-width: 100%;
    }

    > * {
      flex-shrink: 0;
    }

    h2 {
      margin: 0;
      font-size: 22px;
    }

    h3 {
      margin: 0;
      font-size: 18px;
    }

    [role='tab'] {
      min-height: 44px;
    }

    @media (width <= 767px) {
      h2 {
        font-size: 20px;
      }

      h3 {
        font-size: 16px;
      }

      button {
        overflow-wrap: break-word;
        white-space: normal;
      }
    }
  `,
  detail: css`
    min-width: 0;

    /* 统一 10px 总边距口径：详情盒自身的填充清零。2026-09-18：边框整圈去掉，不再有上下左右边线。 */
    padding: 0;
    border: 0;
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};

    [role='tabpanel'] {
      min-width: 0;
    }
  `,
  detailTabs: css`
    overflow: hidden;
    width: 100%;
    min-width: 0;

    [role='tablist'] {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      box-sizing: border-box;
      width: 100%;
    }

    [role='tab'] {
      gap: 10px;
      justify-content: center;

      min-width: 0;
      min-height: 56px;
      padding: 12px;

      font-size: 18px;
      font-weight: 600;
    }

    [role='tab'] svg {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
    }

    @container (max-width: 620px) {
      [role='tablist'] {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      [role='tab'] {
        gap: 6px;
        min-height: 48px;
        padding: 8px;
        font-size: 14px;
      }

      [role='tab'] svg {
        width: 18px;
        height: 18px;
      }
    }
  `,
  workspaceTabs: css`
    overflow: hidden;
    width: 100%;
    min-width: 0;

    [role='tablist'] {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      width: 100%;
    }

    [role='tab'] {
      gap: 6px;
      justify-content: center;
      min-width: 0;
      padding-inline: 12px;
    }
  `,
  contentTabs: css`
    overflow: hidden;
    width: 100%;
    min-width: 0;

    [role='tablist'] {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      width: 100%;
    }

    [role='tab'] {
      gap: 4px;
      justify-content: center;

      min-width: 0;
      padding-inline: 8px;

      font-size: 14px;
    }

    [role='tab'] svg {
      flex-shrink: 0;
    }

    @container (max-width: 420px) {
      [role='tab'] {
        padding-inline: 4px;
        font-size: 12px;
      }
    }
  `,
  field: css`
    min-width: 0;
    max-width: 100%;

    > :last-child {
      min-width: 0;
      max-width: 100%;
    }

    @media (width <= 640px) {
      flex: 1 1 100%;
      width: 100%;

      > :last-child {
        width: 100%;
      }
    }
  `,
  filterRow: css`
    width: 100%;
    min-width: 0;

    > * {
      min-width: 0;
      max-width: 100%;
    }

    @media (width <= 640px) {
      > * {
        flex: 1 1 100% !important;
        width: 100%;
      }
    }
  `,
  pagination: css`
    flex-wrap: wrap;
    width: 100%;
    min-width: 0;

    > * {
      min-width: 0;
      max-width: 100%;
    }

    @media (width <= 420px) {
      row-gap: 8px;

      > :last-child {
        flex-wrap: wrap;
        margin-inline-start: auto;
      }
    }
  `,
  compactCount: css`
    flex: none;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  `,
  creditActionColumn: css`
    flex: 1 1 260px;
    min-width: 0;
    max-width: 100%;

    [role='combobox'] {
      overflow: hidden;
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }

    @container (max-width: 640px) {
      flex-basis: 100%;
      width: 100%;
    }
  `,
  creditActions: css`
    width: 100%;
    min-width: 0;

    > * {
      min-width: 0;
      max-width: 100%;
    }
  `,
  selectValue: css`
    overflow: hidden;
    display: block;

    width: 100%;
    min-width: 0;
    max-width: 100%;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  splitRow: css`
    width: 100%;
    min-width: 0;

    > * {
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
    }

    > :first-child {
      flex: 1 1 240px;
    }

    > :last-child {
      flex: 0 1 auto;
    }

    @media (width <= 640px) {
      > * {
        flex-basis: 100%;
        width: 100%;
      }

      > :last-child {
        text-align: start !important;
      }
    }
  `,
  metrics: css`
    display: flex;
    flex-wrap: wrap;
    gap: 24px;

    padding: 8px;
    border-block: 0.5px solid ${cssVar.colorBorderSecondary};

    > * {
      flex: 1 1 220px;
      min-width: 0;
      overflow-wrap: anywhere;
    }
  `,
  accountForm: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: stretch;

    width: 100%;

    > * {
      min-width: 0;
      padding: 20px;
      border: 0.5px solid ${cssVar.colorBorderSecondary};
      border-radius: 12px;
    }

    button {
      align-self: flex-start;
    }

    @media (width <= 900px) {
      grid-template-columns: minmax(0, 1fr);
    }

    @media (width <= 640px) {
      > * {
        padding: 12px;
      }
    }
  `,
  securitySummaryGrid: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    align-items: start;

    > * {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    @container (max-width: 760px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  workspace: css`
    display: grid;
    gap: 24px;
    align-items: start;
    min-width: 0;

    > * {
      min-width: 0;
    }
  `,
  directory: css`
    /* Match the saved flat layout on the first paint, before modifier rules load.
       The settings shell already supplies the 48px page gutter. */
    padding: 0;
    border: 0;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  customerTable: css`
    overflow-x: auto;

    table {
      border-collapse: collapse;
      width: 100%;
      min-width: 760px;
      text-align: start;
    }

    th,
    td {
      padding: 12px;
      border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
      vertical-align: top;
    }

    th {
      font-weight: 500;
      color: ${cssVar.colorTextSecondary};
      white-space: nowrap;
    }
  `,
  customer: css`
    padding: 12px;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};

    &[data-selected='true'] {
      background: ${cssVar.colorFillTertiary};
    }

    summary {
      cursor: pointer;
      padding-block: 12px;
    }

    summary:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
}));

type LambdaOutputs = inferRouterOutputs<LambdaRouter>;
type AdminAuditEvent = LambdaOutputs['platformOperations']['listAuditEvents']['items'][number];
type CreditEntry = LambdaOutputs['platformCredit']['listUserEntries'][number];
type PendingReservation = LambdaOutputs['platformCredit']['listPendingReservations'][number];
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
type CustomerDetailTab = 'credits' | 'groups' | 'overview' | 'security';
type ServiceOperationsWorkspace = 'customers' | 'moderation' | 'template';

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
  if (!redacted) return translateTravel('未记录');

  const characters = Array.from(redacted);
  return characters.length > 80 ? `${characters.slice(0, 80).join('')}…` : redacted;
};

const parseLocalBanExpiry = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match)
    throw new OperationValidationError(translateTravel('封禁到期时间必须是有效的未来本地时间'));

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
    throw new OperationValidationError(translateTravel('封禁到期时间必须是有效的未来本地时间'));
  }

  return expiresAt;
};

const formatCredits = (credits?: number) =>
  credits !== undefined && Number.isSafeInteger(credits)
    ? translateTravel('{{v0}} 积分', {
        v0: new Intl.NumberFormat(getTravelLocale()).format(credits),
      })
    : translateTravel('积分暂不可用');

const formatDate = (value: Date | string | null) =>
  value
    ? new Intl.DateTimeFormat(getTravelLocale(), {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : translateTravel('无');

const groupStatusLabel = (readiness?: UserOverview['travelGroup']['readiness']) => {
  if (readiness === 'ready') return translateTravel('群组已就绪');
  if (readiness === 'incomplete') return translateTravel('群组待补齐');
  if (readiness === 'missing') return translateTravel('群组未初始化');
  return translateTravel('群组状态读取中');
};

const entryTypeLabel = (type: CreditEntry['type']) => {
  if (type === 'top_up') return translateTravel('充值');
  if (type === 'adjustment') return translateTravel('人工调整');
  if (type === 'usage_charge') return translateTravel('用量扣费');
  if (type === 'reversal') return translateTravel('冲正');
  return type;
};

const pendingReservationStatusLabel = (status: PendingReservation['status']) =>
  status === 'provider_completed'
    ? translateTravel('等待本地结算')
    : translateTravel('服务商结果未知');

const moderationSourceLabel = (sourceType: ModerationRecord['sourceType']) => {
  if (sourceType === 'chat') return translateTravel('对话');
  if (sourceType === 'copy') return translateTravel('文案生成');
  if (sourceType === 'document') return translateTravel('文档生成');
  if (sourceType === 'image') return translateTravel('图片生成');
  if (sourceType === 'video') return translateTravel('视频生成');
  return sourceType;
};

const moderationVerdictLabel = (verdict: ModerationRecord['verdict']) => {
  if (verdict === 'allow') return translateTravel('通过');
  if (verdict === 'review') return translateTravel('待人工审核');
  if (verdict === 'block') return translateTravel('拦截');
  return verdict;
};

const moderationDispositionLabel = (disposition: ModerationRecord['disposition']) => {
  if (disposition === 'pending') return translateTravel('待处理');
  if (disposition === 'reviewed') return translateTravel('已复核');
  if (disposition === 'cleared') return translateTravel('已解除');
  if (disposition === 'ban_recommended') return translateTravel('已建议封禁');
  return disposition;
};

const moderationCategoryLabel = (category: ModerationRecord['categories'][number]['category']) => {
  if (category === 'credential') return translateTravel('凭证或密钥');
  if (category === 'email') return translateTravel('邮箱');
  if (category === 'government_id') return translateTravel('身份证件');
  if (category === 'phone') return translateTravel('电话');
  if (category === 'provider_moderation') return translateTravel('服务商审核');
  return category;
};

const adminAuditActionLabel = (action: AdminAuditEvent['action']) => {
  if (action === 'user.profile_updated') return translateTravel('资料已修改');
  if (action === 'user.banned') return translateTravel('账号已封禁');
  if (action === 'user.unbanned') return translateTravel('账号已解禁');
  if (action === 'user.password_reset_requested') return translateTravel('密码重置已请求');
  if (action === 'user.sessions_revoked') return translateTravel('会话已撤销');
  if (action === 'user.travel_group_repaired') return translateTravel('私人群已安全修复');
  return action;
};

const adminAuditPhaseLabel = (phase: AdminAuditEvent['phase']) => {
  if (phase === 'requested') return translateTravel('已请求');
  if (phase === 'succeeded') return translateTravel('成功');
  if (phase === 'failed') return translateTravel('失败');
  return phase;
};

const parseCredits = (raw: string, positiveOnly: boolean) => {
  const value = raw.trim();
  if (!/^[+-]?\d+$/.test(value)) {
    throw new OperationValidationError(translateTravel('积分必须为安全范围内的整数'));
  }

  const credits = Number(value);
  if (!Number.isSafeInteger(credits)) {
    throw new OperationValidationError(translateTravel('积分必须为安全范围内的整数'));
  }
  if (credits === 0) throw new OperationValidationError(translateTravel('积分不能为 0'));
  if (positiveOnly && credits < 1) {
    throw new OperationValidationError(translateTravel('充值积分必须大于 0'));
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

const Field = ({
  children,
  label,
  icon,
}: {
  children: React.ReactNode;
  label: string;
  icon?: React.ReactNode;
}) => {
  return (
    <Flexbox className={styles.field} gap={6}>
      <Text
        as={'label'}
        fontSize={12}
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        weight={500}
      >
        {icon}
        {label}
      </Text>
      {children}
    </Flexbox>
  );
};

const Metric = ({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) => {
  return (
    <div>
      <Flexbox gap={4}>
        <Text
          color={'secondary'}
          fontSize={12}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          {icon}
          {label}
        </Text>
        <Text weight={600}>{value}</Text>
      </Flexbox>
    </div>
  );
};

const UserAdminAuditSection = ({
  error,
  events,
  loading,
}: {
  error: unknown;
  events: AdminAuditEvent[];
  loading: boolean;
}) => {
  const translateTravel = useTravelTranslation();
  return (
    <Block padding={20} variant={'outlined'}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          <FileClock size={18} />
          <Text weight={600}>{translateTravel('最近安全操作')}</Text>
        </Flexbox>
        <Text color={'secondary'}>
          {translateTravel(
            '仅显示管理员、目标用户、操作类型、阶段和时间，不读取操作内容、幂等标识或认证数据。',
          )}
        </Text>
        {error ? (
          <Alert title={translateTravel('最近安全操作暂时无法读取')} />
        ) : loading ? (
          <Text color={'secondary'}>{translateTravel('正在读取最近安全操作…')}</Text>
        ) : events.length === 0 ? (
          <Text color={'secondary'}>{translateTravel('暂无安全操作记录')}</Text>
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
                  <Text color={'secondary'}>
                    {translateTravel('操作管理员：{{v0}}', { v0: event.operatorUserId })}
                  </Text>
                  <Text color={'secondary'}>
                    {translateTravel('目标用户：{{v0}}', { v0: event.targetUserId })}
                  </Text>
                  <Text color={'secondary'}>
                    {translateTravel('操作时间：{{v0}}', { v0: formatDate(event.occurredAt) })}
                  </Text>
                </Flexbox>
              </Block>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </Block>
  );
};

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
  const translateTravel = useTravelTranslation();
  const [activeKind, setActiveKind] = useState<ContentCatalogKind>('generation');
  const counts = catalogs.generation?.counts ?? catalogs.work?.counts ?? catalogs.document?.counts;
  const sections = [
    {
      count: counts?.generationTasks,
      items: catalogs.generation?.items ?? [],
      kind: 'generation' as const,
      label: translateTravel('生成任务'),
      nextCursor: catalogs.generation?.nextCursor,
    },
    {
      count: counts?.works,
      items: catalogs.work?.items ?? [],
      kind: 'work' as const,
      label: translateTravel('作品'),
      nextCursor: catalogs.work?.nextCursor,
    },
    {
      count: counts?.documents,
      items: catalogs.document?.items ?? [],
      kind: 'document' as const,
      label: translateTravel('文档'),
      nextCursor: catalogs.document?.nextCursor,
    },
  ];

  return (
    <Block padding={20} variant={'outlined'}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          <FileClock size={18} />
          <Text weight={600}>{translateTravel('用户内容')}</Text>
        </Flexbox>
        <Text color={'secondary'}>
          {translateTravel('按类别查看该用户的内容记录。当前仅提供目录信息。')}
        </Text>

        <Tabs
          activeKey={activeKind}
          className={styles.contentTabs}
          items={sections.map((section) => ({
            key: section.kind,
            icon:
              section.kind === 'generation' ? (
                <Sparkles aria-hidden size={16} />
              ) : section.kind === 'work' ? (
                <Folders aria-hidden size={16} />
              ) : (
                <FileText aria-hidden size={16} />
              ),
            label: `${section.label} ${section.count ?? '—'}`,
          }))}
          onChange={(key) => setActiveKind(key as ContentCatalogKind)}
        />
        <Flexbox gap={12}>
          {sections
            .filter((section) => section.kind === activeKind)
            .map((section) => {
              const filters = filterInputs[section.kind];
              const hasFilters = Object.values(filters).some(Boolean);
              return (
                <Flexbox
                  aria-label={translateTravel('{{v0}}内容目录', { v0: section.label })}
                  key={section.kind}
                  role={'region'}
                  style={{ minWidth: 0 }}
                >
                  <Flexbox gap={8}>
                    {(Boolean(section.count) || hasFilters) && (
                      <details>
                        <summary style={{ cursor: 'pointer', paddingBlock: 8 }}>
                          {translateTravel('筛选')}
                          {section.label}
                        </summary>
                        <Flexbox
                          horizontal
                          align={'end'}
                          className={styles.filterRow}
                          gap={8}
                          wrap={'wrap'}
                        >
                          <Field label={translateTravel('{{v0}}类型', { v0: section.label })}>
                            <Input
                              aria-label={translateTravel('{{v0}}类型', { v0: section.label })}
                              maxLength={100}
                              placeholder={translateTravel('全部类型')}
                              value={filters.type}
                              onChange={(event) =>
                                onFilterInputChange(section.kind, 'type', event.currentTarget.value)
                              }
                            />
                          </Field>
                          {section.kind !== 'document' && (
                            <Field label={translateTravel('{{v0}}状态', { v0: section.label })}>
                              <Input
                                aria-label={translateTravel('{{v0}}状态', { v0: section.label })}
                                maxLength={100}
                                placeholder={translateTravel('全部状态')}
                                value={filters.status}
                                onChange={(event) =>
                                  onFilterInputChange(
                                    section.kind,
                                    'status',
                                    event.currentTarget.value,
                                  )
                                }
                              />
                            </Field>
                          )}
                          <Field label={translateTravel('{{v0}}开始日期', { v0: section.label })}>
                            <Input
                              aria-label={translateTravel('{{v0}}开始日期', { v0: section.label })}
                              type={'date'}
                              value={filters.startDate}
                              onChange={(event) =>
                                onFilterInputChange(
                                  section.kind,
                                  'startDate',
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </Field>
                          <Field label={translateTravel('{{v0}}结束日期', { v0: section.label })}>
                            <Input
                              aria-label={translateTravel('{{v0}}结束日期', { v0: section.label })}
                              type={'date'}
                              value={filters.endDate}
                              onChange={(event) =>
                                onFilterInputChange(
                                  section.kind,
                                  'endDate',
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </Field>
                          <Button onClick={() => onApplyFilters(section.kind)}>
                            {translateTravel('应用{{v0}}筛选', { v0: section.label })}
                          </Button>
                        </Flexbox>
                      </details>
                    )}

                    {errors[section.kind] ? (
                      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                        <Alert
                          title={translateTravel('{{v0}}内容摘要暂时无法读取', {
                            v0: section.label,
                          })}
                        />
                        <Button onClick={() => onRetry(section.kind)}>
                          {translateTravel('重试{{v0}}内容摘要', { v0: section.label })}
                        </Button>
                      </Flexbox>
                    ) : loading[section.kind] ? (
                      <Text color={'secondary'}>
                        {translateTravel('正在读取{{v0}}内容摘要…', { v0: section.label })}
                      </Text>
                    ) : section.items.length === 0 ? (
                      <Text color={'secondary'} style={{ paddingBlock: 24 }}>
                        {hasFilters
                          ? translateTravel('暂无匹配条目，请调整筛选条件')
                          : translateTravel('该用户暂无{{v0}}', { v0: section.label })}
                      </Text>
                    ) : (
                      section.items.map((item) => (
                        <Flexbox
                          key={`${item.kind}-${item.id}`}
                          paddingBlock={12}
                          style={{
                            borderBottom: `0.5px solid ${cssVar.colorBorderSecondary}`,
                            minWidth: 0,
                            overflowWrap: 'anywhere',
                          }}
                        >
                          <Flexbox gap={5}>
                            <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                              <Text weight={600}>{item.title || item.filename || item.id}</Text>
                              <Tag>{item.type}</Tag>
                              {item.status && <Tag>{contentStatusLabel(item.status)}</Tag>}
                            </Flexbox>
                            {item.filename && (
                              <Text color={'secondary'}>
                                {translateTravel('文件名：{{v0}}', { v0: item.filename })}
                              </Text>
                            )}
                            <Text color={'secondary'}>
                              {translateTravel('更新时间：{{v0}}', {
                                v0: formatDate(item.updatedAt),
                              })}
                            </Text>
                          </Flexbox>
                        </Flexbox>
                      ))
                    )}

                    {!errors[section.kind] &&
                      !loading[section.kind] &&
                      (pageIndexes[section.kind] > 0 || section.nextCursor) && (
                        <Flexbox
                          horizontal
                          align={'center'}
                          className={styles.pagination}
                          gap={8}
                          justify={'space-between'}
                        >
                          <Button
                            disabled={pageIndexes[section.kind] === 0}
                            onClick={() => onPreviousPage(section.kind)}
                          >
                            {translateTravel('{{v0}}上一页', { v0: section.label })}
                          </Button>
                          <Button
                            disabled={!section.nextCursor}
                            onClick={() => {
                              if (section.nextCursor) onNextPage(section.kind, section.nextCursor);
                            }}
                          >
                            {translateTravel('{{v0}}下一页', { v0: section.label })}
                          </Button>
                        </Flexbox>
                      )}
                  </Flexbox>
                </Flexbox>
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
  const translateTravel = useTravelTranslation();
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
      toast.success(translateTravel('私人旅游群已按安全预案修复'));
      try {
        await onChanged();
      } catch {
        toast.error(translateTravel('修复已成功，但最新健康状态刷新失败，请手动刷新页面'));
      }
    } catch {
      setActionError(translateTravel('私人旅游群未安全完成修复，请重新读取预案后重试'));
      toast.error(translateTravel('私人旅游群未安全完成修复，请重试'));
    } finally {
      actionInFlightRef.current = false;
      setRepairing(false);
    }
  };

  return (
    <Block
      aria-label={translateTravel('私人群健康与修复预案')}
      padding={20}
      role={'region'}
      style={{ maxWidth: '100%', minWidth: 0 }}
      variant={'outlined'}
    >
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <ShieldAlert size={18} />
            <Text weight={600}>{translateTravel('私人群健康与修复预案')}</Text>
          </Flexbox>
          <Tag color={overview ? (overview.ready ? 'green' : 'red') : undefined}>
            {overview
              ? overview.ready
                ? translateTravel('状态：健康')
                : translateTravel('状态：需检查')
              : translateTravel('状态：读取中')}
          </Tag>
        </Flexbox>
        <Text color={'secondary'}>
          {translateTravel(
            '仅展示固定问题代码和建议动作计数；安全预案需要管理员明确确认，且服务端会在执行前重新校验。',
          )}
        </Text>

        {error ? (
          <Alert title={translateTravel('私人群健康与修复预案暂时无法读取')} />
        ) : loading || !overview ? (
          <Text color={'secondary'}>{translateTravel('正在读取私人群健康…')}</Text>
        ) : (
          <>
            {overview.reviewRequired && (
              <Alert title={translateTravel('需要人工审核，不会自动修复')} />
            )}
            {!targetActive && (
              <Alert title={translateTravel('目标用户已封禁，不允许执行私人群修复')} />
            )}

            <div
              style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
            >
              <Block
                gap={6}
                padding={16}
                style={{ minWidth: 0, overflowWrap: 'anywhere' }}
                variant={'borderless'}
              >
                <Flexbox horizontal align={'center'} gap={8}>
                  <ShieldAlert aria-hidden size={18} />
                  <Text weight={600}>{translateTravel('群健康问题代码')}</Text>
                </Flexbox>
                {overview.issueCodes.length === 0 ? (
                  <Text color={'secondary'}>{translateTravel('未发现已知问题代码')}</Text>
                ) : (
                  <div
                    aria-label={translateTravel('群健康问题代码')}
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
              </Block>

              <Block
                gap={6}
                padding={16}
                style={{ minWidth: 0, overflowWrap: 'anywhere' }}
                variant={'borderless'}
              >
                <Flexbox horizontal align={'center'} gap={8}>
                  <ListChecks aria-hidden size={18} />
                  <Text weight={600}>{translateTravel('建议动作预览')}</Text>
                </Flexbox>
                {overview.actionCounts.length === 0 ? (
                  <Text color={'secondary'}>{translateTravel('无建议动作')}</Text>
                ) : (
                  <Flexbox horizontal gap={8} style={{ minWidth: 0 }} wrap={'wrap'}>
                    {overview.actionCounts.map(({ code, count }) => (
                      <Tag color={code.includes('REVIEW_REQUIRED') ? 'red' : 'gold'} key={code}>
                        {`${code} × ${count}`}
                      </Tag>
                    ))}
                  </Flexbox>
                )}
              </Block>
            </div>

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
                  {translateTravel('执行安全修复')}
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
                      {translateTravel('确认修复该用户的私人旅游群？')}
                    </Text>
                    <Text color={'secondary'} id={dialogDescriptionId}>
                      {translateTravel(
                        '只执行上方已预览的安全白名单动作；如果群状态已变化，服务端将拒绝执行。',
                      )}
                    </Text>
                    <Flexbox horizontal gap={8} style={{ minWidth: 0 }} wrap={'wrap'}>
                      <Button
                        autoFocus
                        disabled={repairing || repairMutation.isPending}
                        onClick={() => setConfirmationFingerprint('')}
                      >
                        {translateTravel('取消')}
                      </Button>
                      <Button
                        disabled={repairing || repairMutation.isPending}
                        loading={repairing || repairMutation.isPending}
                        type={'primary'}
                        onClick={repairTravelGroup}
                      >
                        {translateTravel('确认执行安全修复')}
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
  const translateTravel = useTravelTranslation();
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
      toast.success(translateTravel('该用户的全部会话已撤销'));
      try {
        await onChanged();
      } catch {
        toast.error(translateTravel('会话已撤销，但最新数据刷新失败，请手动刷新页面'));
      }
    } catch {
      setActionError(translateTravel('会话撤销未安全完成，请重试'));
      toast.error(translateTravel('会话撤销未安全完成，请重试'));
    } finally {
      actionInFlightRef.current = false;
      setRevoking(false);
    }
  };

  return (
    <Block padding={20} style={{ width: '100%', minWidth: 0 }} variant={'outlined'}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <ShieldAlert size={18} />
            <Text weight={600}>{translateTravel('登录会话安全概览')}</Text>
          </Flexbox>
          <Text className={styles.compactCount} color={'secondary'}>
            {translateTravel('会话总数：{{v0}}', { v0: overview?.total ?? '—' })}
          </Text>
        </Flexbox>
        <Text color={'secondary'}>
          {translateTravel(
            '仅显示最近 10 条会话的时间、过期时间、IP 和 User-Agent；不读取 token 或 Cookie。',
          )}
        </Text>

        {error ? (
          <Alert title={translateTravel('登录会话暂时无法读取')} />
        ) : loading ? (
          <Text color={'secondary'}>{translateTravel('正在读取登录会话…')}</Text>
        ) : sessions.length === 0 ? (
          <Text color={'secondary'}>{translateTravel('暂无有效登录会话记录')}</Text>
        ) : (
          <Flexbox gap={8}>
            {sessions.map((session, index) => (
              <Block
                key={`${String(session.updatedAt)}-${String(session.createdAt)}-${index}`}
                padding={12}
                variant={'outlined'}
              >
                <Flexbox gap={5}>
                  <Text>
                    {translateTravel('创建时间：{{v0}}', { v0: formatDate(session.createdAt) })}
                  </Text>
                  <Text color={'secondary'}>
                    {translateTravel('更新时间：{{v0}}', { v0: formatDate(session.updatedAt) })}
                  </Text>
                  <Text color={'secondary'}>
                    {translateTravel('过期时间：{{v0}}', { v0: formatDate(session.expiresAt) })}
                  </Text>
                  <Text
                    color={'secondary'}
                  >{`IP：${session.ipAddress || translateTravel('未记录')}`}</Text>
                  <Text
                    color={'secondary'}
                  >{`User-Agent：${session.userAgent || translateTravel('未记录')}`}</Text>
                </Flexbox>
              </Block>
            ))}
          </Flexbox>
        )}

        {isCurrentAdministrator ? (
          <Alert title={translateTravel('当前管理员请在个人中心管理自己的会话')} />
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
              {translateTravel('撤销该用户全部会话')}
            </Button>
            {confirmationOpen && (
              <Flexbox
                aria-describedby={dialogDescriptionId}
                aria-labelledby={dialogTitleId}
                gap={10}
                role={'alertdialog'}
              >
                <Text id={dialogTitleId} weight={600}>
                  {translateTravel('确认撤销该用户全部会话？')}
                </Text>
                <Text color={'secondary'} id={dialogDescriptionId}>
                  {translateTravel('确认后，该用户所有设备都需要重新登录。')}
                </Text>
                <Flexbox horizontal gap={8} wrap={'wrap'}>
                  <Button
                    autoFocus
                    disabled={revoking || revokeMutation.isPending}
                    onClick={() => setConfirmationOpen(false)}
                  >
                    {translateTravel('取消')}
                  </Button>
                  <Button
                    danger
                    disabled={revoking || revokeMutation.isPending}
                    loading={revoking || revokeMutation.isPending}
                    onClick={revokeSessions}
                  >
                    {translateTravel('确认撤销全部会话')}
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
  const translateTravel = useTravelTranslation();
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
  const hasSafetyFilters =
    Object.values(filters).some(Boolean) ||
    Boolean(categoryInput || severityInput || statusInput || startDateInput || endDateInput);

  if (
    !overviewQuery.isLoading &&
    !overviewQuery.error &&
    summary?.total === 0 &&
    items.length === 0 &&
    pageIndex === 0 &&
    !hasSafetyFilters
  ) {
    return (
      <Block
        aria-label={translateTravel('敏感信息安全概览')}
        padding={20}
        role={'region'}
        variant={'outlined'}
      >
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <ShieldAlert size={18} />
          <Text weight={600}>{translateTravel('敏感信息安全概览')}</Text>
          <Text color={'secondary'}>{translateTravel('暂无安全事件')}</Text>
        </Flexbox>
      </Block>
    );
  }

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
    <Block
      aria-label={translateTravel('敏感信息安全概览')}
      padding={20}
      role={'region'}
      variant={'outlined'}
    >
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          <ShieldAlert size={18} />
          <Text weight={600}>{translateTravel('敏感信息安全概览')}</Text>
        </Flexbox>
        <Text color={'secondary'}>
          {translateTravel(
            '仅显示汇总计数、固定检测分类、结论、处置状态、时间和安全标识；不读取原文、提示词、消息正文或认证数据。本区不提供删除或封禁操作。',
          )}
        </Text>

        <Flexbox horizontal gap={8} wrap={'wrap'}>
          <Tag>{translateTravel('命中总数 {{v0}}', { v0: summary?.total ?? '—' })}</Tag>
          <Tag color={'red'}>{translateTravel('拦截 {{v0}}', { v0: summary?.block ?? '—' })}</Tag>
          <Tag color={'gold'}>
            {translateTravel('待人工审核 {{v0}}', { v0: summary?.review ?? '—' })}
          </Tag>
          <Tag>{translateTravel('待处理 {{v0}}', { v0: summary?.pending ?? '—' })}</Tag>
          <Tag>{translateTravel('已复核 {{v0}}', { v0: summary?.reviewed ?? '—' })}</Tag>
        </Flexbox>

        <Flexbox horizontal align={'end'} className={styles.filterRow} gap={8} wrap={'wrap'}>
          <Field label={translateTravel('安全分类')}>
            <Select
              aria-label={translateTravel('安全分类')}
              value={categoryInput}
              options={[
                { label: translateTravel('全部分类'), value: '' },
                { label: translateTravel('凭证或密钥'), value: 'credential' },
                { label: translateTravel('邮箱'), value: 'email' },
                { label: translateTravel('身份证件'), value: 'government_id' },
                { label: translateTravel('电话'), value: 'phone' },
                { label: translateTravel('服务商审核'), value: 'provider_moderation' },
              ]}
              onChange={(value) =>
                setCategoryInput(value as '' | UserSafetyEvent['categories'][number]['category'])
              }
            />
          </Field>
          <Field label={translateTravel('严重级别')}>
            <Select
              aria-label={translateTravel('严重级别')}
              value={severityInput}
              options={[
                { label: translateTravel('全部级别'), value: '' },
                { label: translateTravel('严重'), value: 'critical' },
                { label: translateTravel('高'), value: 'high' },
                { label: translateTravel('中'), value: 'medium' },
              ]}
              onChange={(value) =>
                setSeverityInput(value as '' | UserSafetyEvent['categories'][number]['severity'])
              }
            />
          </Field>
          <Field label={translateTravel('安全处置状态')}>
            <Select
              aria-label={translateTravel('安全处置状态')}
              value={statusInput}
              options={[
                { label: translateTravel('全部状态'), value: '' },
                { label: translateTravel('待处理'), value: 'pending' },
                { label: translateTravel('已复核'), value: 'reviewed' },
                { label: translateTravel('已解除'), value: 'cleared' },
                { label: translateTravel('已建议封禁'), value: 'ban_recommended' },
              ]}
              onChange={(value) => setStatusInput(value as '' | UserSafetyEvent['disposition'])}
            />
          </Field>
          <Field label={translateTravel('开始日期')}>
            <Input
              aria-label={translateTravel('开始日期')}
              type={'date'}
              value={startDateInput}
              onChange={(event) => setStartDateInput(event.currentTarget.value)}
            />
          </Field>
          <Field label={translateTravel('结束日期')}>
            <Input
              aria-label={translateTravel('结束日期')}
              type={'date'}
              value={endDateInput}
              onChange={(event) => setEndDateInput(event.currentTarget.value)}
            />
          </Field>
          <Button onClick={applyFilters}>{translateTravel('应用安全筛选')}</Button>
        </Flexbox>

        {overviewQuery.error ? (
          <Alert title={translateTravel('敏感信息安全概览暂时无法读取')} />
        ) : overviewQuery.isLoading ? (
          <Text color={'secondary'}>{translateTravel('正在读取安全事件…')}</Text>
        ) : items.length === 0 ? (
          <Text color={'secondary'}>{translateTravel('暂无匹配的安全事件')}</Text>
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
                  <Text color={'secondary'}>
                    {translateTravel('安全事件 ID：{{v0}}', { v0: item.id })}
                  </Text>
                  <Text color={'secondary'}>
                    {translateTravel('检测时间：{{v0}}', { v0: formatDate(item.detectedAt) })}
                  </Text>
                  <Text color={'secondary'}>
                    {translateTravel('处置时间：{{v0}}', { v0: formatDate(item.disposedAt) })}
                  </Text>
                </Flexbox>
              </Block>
            ))}
          </Flexbox>
        )}

        <Flexbox
          horizontal
          align={'center'}
          className={styles.pagination}
          gap={8}
          justify={'space-between'}
        >
          <Button disabled={pageIndex === 0} onClick={() => setPageIndex((value) => value - 1)}>
            {translateTravel('安全事件上一页')}
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
            {translateTravel('安全事件下一页')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Block>
  );
};

const ModerationSection = () => {
  const translateTravel = useTravelTranslation();
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
      toast.error(translateTravel('处置已成功，但审计数据刷新失败，请手动刷新页面'));
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
        toast.success(translateTravel('已标记为复核'));
      } else if (action === 'cleared') {
        await clearMutation.mutateAsync({ id: selectedRecordId });
        toast.success(translateTravel('已解除该条审计记录'));
      } else {
        await recommendBanMutation.mutateAsync({ id: selectedRecordId });
        toast.success(translateTravel('已记录封禁建议，未直接封禁用户'));
      }
      await refreshModeration();
    } catch {
      setModerationError(translateTravel('处置失败，请重试'));
      toast.error(translateTravel('处置失败，请重试'));
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
    <Block
      className={styles.auditPanel}
      data-testid="service-operations-audit-panel"
      variant={'borderless'}
    >
      <Flexbox gap={16}>
        <Flexbox gap={6}>
          <Flexbox horizontal align={'center'} gap={8}>
            <ShieldAlert size={20} />
            <Text as={'h3'} weight={600}>
              {translateTravel('敏感信息')}
            </Text>
          </Flexbox>
          <Text color={'secondary'}>
            {translateTravel(
              '列表仅显示审计结论和分类；选中记录后才读取脱敏预览。不显示指纹、原文、提示词、模型或密钥。',
            )}
          </Text>
        </Flexbox>

        <Flexbox horizontal align={'end'} className={styles.filterRow} gap={10} wrap={'wrap'}>
          <Flexbox gap={6} style={{ flex: '1 1 240px' }}>
            <Text as={'label'} fontSize={12} weight={500}>
              {translateTravel('用户 ID')}
            </Text>
            <Input
              aria-label={translateTravel('用户 ID')}
              placeholder={translateTravel('留空查看全部用户')}
              value={userIdInput}
              onChange={(event) => setUserIdInput(event.currentTarget.value)}
            />
          </Flexbox>
          <Flexbox gap={6} style={{ flex: '1 1 180px' }}>
            <Text as={'label'} fontSize={12} weight={500}>
              {translateTravel('处置状态')}
            </Text>
            <Select
              aria-label={translateTravel('处置状态')}
              placeholder={translateTravel('全部处置状态')}
              value={dispositionInput}
              options={[
                { label: translateTravel('全部处置状态'), value: '' },
                { label: translateTravel('待处理'), value: 'pending' },
                { label: translateTravel('已复核'), value: 'reviewed' },
                { label: translateTravel('已解除'), value: 'cleared' },
                { label: translateTravel('已建议封禁'), value: 'ban_recommended' },
              ]}
              onChange={(value) =>
                setDispositionInput(value as '' | ModerationRecord['disposition'])
              }
            />
          </Flexbox>
          <Flexbox gap={6} style={{ flex: '1 1 180px' }}>
            <Text as={'label'} fontSize={12} weight={500}>
              {translateTravel('检测结论')}
            </Text>
            <Select
              aria-label={translateTravel('检测结论')}
              placeholder={translateTravel('全部检测结论')}
              value={verdictInput}
              options={[
                { label: translateTravel('全部检测结论'), value: '' },
                { label: translateTravel('通过'), value: 'allow' },
                { label: translateTravel('待人工审核'), value: 'review' },
                { label: translateTravel('拦截'), value: 'block' },
              ]}
              onChange={(value) => setVerdictInput(value as '' | ModerationRecord['verdict'])}
            />
          </Flexbox>
          <Button onClick={applyFilters}>{translateTravel('应用筛选')}</Button>
        </Flexbox>

        {recordsQuery.error ? (
          <Alert title={translateTravel('审计列表暂时无法读取')} />
        ) : recordsQuery.isLoading ? (
          <Text color={'secondary'}>{translateTravel('正在读取审计记录…')}</Text>
        ) : records.length === 0 ? (
          <Text color={'secondary'}>{translateTravel('暂无匹配的审计记录')}</Text>
        ) : (
          <Flexbox gap={10}>
            {records.map((record) => (
              <Block key={record.id} padding={14} variant={'outlined'}>
                <Flexbox
                  horizontal
                  align={'center'}
                  className={styles.splitRow}
                  gap={12}
                  justify={'space-between'}
                  wrap={'wrap'}
                >
                  <Flexbox gap={5} style={{ flex: '1 1 460px', padding: 8 }}>
                    <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                      <Text weight={600}>{moderationSourceLabel(record.sourceType)}</Text>
                      <Tag color={record.verdict === 'block' ? 'red' : 'gold'}>
                        {moderationVerdictLabel(record.verdict)}
                      </Tag>
                      <Tag>{moderationDispositionLabel(record.disposition)}</Tag>
                    </Flexbox>
                    <Text color={'secondary'}>
                      {translateTravel('用户 ID：{{v0}}', { v0: record.userId })}
                    </Text>
                    <Flexbox horizontal gap={6} wrap={'wrap'}>
                      {record.categories.map((finding) => (
                        <Tag key={`${finding.category}-${finding.severity}`}>
                          {`${moderationCategoryLabel(finding.category)} · ${finding.severity} · ${finding.count}`}
                        </Tag>
                      ))}
                    </Flexbox>
                    <Text color={'secondary'}>
                      {translateTravel('检测时间：{{v0}}', { v0: formatDate(record.detectedAt) })}
                    </Text>
                  </Flexbox>
                  <Button
                    onClick={() => {
                      setModerationError('');
                      setSelectedRecordId(record.id);
                    }}
                  >
                    {translateTravel('查看审计详情')}
                  </Button>
                </Flexbox>
              </Block>
            ))}
          </Flexbox>
        )}

        <Flexbox
          horizontal
          align={'center'}
          className={styles.pagination}
          gap={8}
          justify={'space-between'}
        >
          <Text className={styles.compactCount} color={'secondary'}>
            {translateTravel('共 {{v0}} 条审计记录', { v0: total })}
          </Text>
          <Flexbox horizontal gap={8}>
            <Button
              disabled={offset === 0}
              onClick={() => {
                setSelectedRecordId('');
                setOffset(Math.max(0, offset - MODERATION_PAGE_SIZE));
              }}
            >
              {translateTravel('上一页')}
            </Button>
            <Button
              disabled={offset + records.length >= total}
              onClick={() => {
                setSelectedRecordId('');
                setOffset(offset + MODERATION_PAGE_SIZE);
              }}
            >
              {translateTravel('下一页')}
            </Button>
          </Flexbox>
        </Flexbox>

        {/* 2026-09-18：详情从列表底部内嵌块改为居中弹窗显示（用户要求）。 */}
        <Modal
          footer={null}
          open={Boolean(selectedRecordId)}
          title={translateTravel('脱敏审计详情')}
          width={520}
          onCancel={() => setSelectedRecordId('')}
        >
          <Flexbox gap={10}>
            {detailQuery.error ? (
              <Alert title={translateTravel('审计详情暂时无法读取')} />
            ) : detailQuery.isLoading || !detailQuery.data ? (
              <Text color={'secondary'}>{translateTravel('正在读取脱敏预览…')}</Text>
            ) : (
              <>
                <Block padding={12} variant={'outlined'}>
                  <Text>
                    {detailQuery.data.redactedPreview || translateTravel('无可展示的脱敏预览')}
                  </Text>
                </Block>
                <Text color={'secondary'}>
                  {translateTravel('封禁建议只记录处置建议，不会直接封禁用户。')}
                </Text>
                {moderationError && <Alert title={moderationError} />}
                <Flexbox horizontal gap={8} wrap={'wrap'}>
                  <Button
                    disabled={isMutating}
                    loading={activeDisposition === 'reviewed' || markReviewedMutation.isPending}
                    onClick={() => setDisposition('reviewed')}
                  >
                    {translateTravel('标记已复核')}
                  </Button>
                  <Button
                    disabled={isMutating}
                    loading={activeDisposition === 'cleared' || clearMutation.isPending}
                    onClick={() => setDisposition('cleared')}
                  >
                    {translateTravel('解除记录')}
                  </Button>
                  <Button
                    disabled={isMutating}
                    loading={
                      activeDisposition === 'ban_recommended' || recommendBanMutation.isPending
                    }
                    onClick={() => setDisposition('ban_recommended')}
                  >
                    {translateTravel('提出封禁建议')}
                  </Button>
                </Flexbox>
              </>
            )}
          </Flexbox>
        </Modal>
      </Flexbox>
    </Block>
  );
};

const UserAccountControls = ({
  onChanged,
  onDeleted,
  user,
}: {
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
  user: UserRow;
}) => {
  const translateTravel = useTravelTranslation();
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
      toast.error(translateTravel('操作已成功，但用户摘要刷新失败，请手动刷新页面'));
    }
  };

  const submitProfile = async () => {
    if (actionInFlightRef.current || isCurrentAdministrator) return;
    const nextFullName = fullName.trim();
    if (!nextFullName) {
      setConfirmation(null);
      setError(translateTravel('用户显示名称不能为空'));
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
      toast.success(translateTravel('用户资料已更新，该用户需重新登录'));
      await refreshAfterSuccess();
    } catch {
      setError(translateTravel('用户资料未安全更新，请重试'));
      toast.error(translateTravel('用户资料未安全更新，请重试'));
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
      toast.success(translateTravel('密码重置邮件已发送，该用户已退出全部设备'));
      await refreshAfterSuccess();
    } catch {
      setError(translateTravel('密码重置未安全完成，请重试'));
      toast.error(translateTravel('密码重置未安全完成，请重试'));
    } finally {
      actionInFlightRef.current = false;
      setActiveAction(null);
    }
  };

  if (!currentUserId) {
    return <Alert title={translateTravel('当前管理员身份暂时无法确认，不允许修改账号资料')} />;
  }

  const confirmationPanel = confirmation && (
    <Flexbox
      aria-describedby={dialogDescriptionId}
      aria-labelledby={dialogTitleId}
      gap={10}
      role={'alertdialog'}
      style={{ padding: 16, background: cssVar.colorFillTertiary, borderRadius: 8 }}
    >
      <Text id={dialogTitleId} weight={600}>
        {confirmation === 'profile'
          ? translateTravel('确认修改该用户资料？')
          : translateTravel('确认强制该用户重置密码？')}
      </Text>
      <Text color={'secondary'} id={dialogDescriptionId}>
        {confirmation === 'profile'
          ? translateTravel('保存后，该用户全部设备需重新登录。')
          : translateTravel('发送一次性重置链接后，旧密码和全部现有会话将失效。')}
      </Text>
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        <Button autoFocus disabled={isMutating} onClick={() => setConfirmation(null)}>
          {translateTravel('取消')}
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
            ? translateTravel('确认保存并退出该用户设备')
            : translateTravel('发送重置链接并退出该用户设备')}
        </Button>
      </Flexbox>
    </Flexbox>
  );

  return (
    <Block padding={20} variant={'outlined'}>
      <Flexbox gap={14}>
        <Flexbox horizontal align={'center'} gap={8}>
          <UserRoundCog size={18} />
          <Text weight={600}>{translateTravel('账号资料与安全')}</Text>
        </Flexbox>
        <Text color={'secondary'}>
          {translateTravel(
            '原密码不可查看。资料更新、修改密码和强制重置都会退出该用户的全部设备。',
          )}
        </Text>

        {isCurrentAdministrator ? (
          <Alert title={translateTravel('当前管理员请在个人中心修改自己的资料和密码')} />
        ) : (
          <>
            <div className={styles.accountForm}>
              <Flexbox gap={12} style={{ minWidth: 0 }}>
                <Field
                  icon={<ContactRound aria-hidden size={16} />}
                  label={translateTravel('用户显示名称')}
                >
                  <Input
                    aria-label={translateTravel('用户显示名称')}
                    maxLength={100}
                    value={fullName}
                    onChange={(event) => setFullName(event.currentTarget.value)}
                  />
                </Field>
                <Field
                  icon={<Image aria-hidden size={16} />}
                  label={translateTravel('用户头像 URL')}
                >
                  <AvatarUrlField value={avatar} onChange={setAvatar} />
                </Field>
                <Button
                  disabled={isMutating}
                  onClick={() => {
                    setConfirmation('profile');
                    setError('');
                  }}
                >
                  {translateTravel('保存用户资料')}
                </Button>
                {confirmation === 'profile' && confirmationPanel}
              </Flexbox>

              <ManagedPasswordControl key={user.id} userId={user.id} onChanged={onChanged} />

              <Flexbox gap={12} style={{ minWidth: 0 }}>
                <Flexbox horizontal align={'center'} gap={6}>
                  <KeyRound size={16} />
                  <Text weight={600}>{translateTravel('强制密码重置')}</Text>
                </Flexbox>
                <Text color={'secondary'}>
                  {translateTravel(
                    '系统向用户邮箱发送旅游群网一次性重置链接，同时废止旧密码和全部现有会话。',
                  )}
                </Text>
                <Button
                  disabled={isMutating}
                  onClick={() => {
                    setConfirmation('reset');
                    setError('');
                  }}
                >
                  {translateTravel('强制密码重置')}
                </Button>
                {confirmation === 'reset' && confirmationPanel}
              </Flexbox>
              <ManagedDeleteControl
                userId={user.id}
                userLabel={`${user.fullName || translateTravel('未命名用户')}（${user.email || user.id}）`}
                onDeleted={onDeleted}
              />
            </div>

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
  const translateTravel = useTravelTranslation();
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const [confirmation, setConfirmation] = useState<'ban' | 'unban' | null>(null);
  const [suspending, setSuspending] = useState(false);
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
      toast.error(translateTravel('操作已成功，但用户摘要刷新失败，请手动刷新页面'));
    }
  };

  const submitBan = async () => {
    if (actionInFlightRef.current) return;
    if (isCurrentAdministrator) {
      setError(translateTravel('不能封禁当前管理员账号'));
      return;
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError(translateTravel('请填写封禁理由'));
      return;
    }
    if (containsSensitiveBanReason(trimmedReason)) {
      setError(translateTravel('封禁理由不得包含密钥或联系方式等敏感信息'));
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
            : translateTravel('封禁到期时间必须是有效的未来本地时间'),
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
      toast.success(translateTravel('用户已封禁'));
      await refreshAfterSuccess();
    } catch {
      setError(translateTravel('封禁失败，请重试'));
      toast.error(translateTravel('封禁失败，请重试'));
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
      toast.success(translateTravel('已解除用户封禁'));
      await refreshAfterSuccess();
    } catch {
      setError(translateTravel('解除封禁失败，请重试'));
      toast.error(translateTravel('解除封禁失败，请重试'));
    } finally {
      actionInFlightRef.current = false;
      setActiveAction(null);
    }
  };

  if (!currentUserId) {
    return <Alert title={translateTravel('当前管理员身份暂时无法确认，不允许变更封禁状态')} />;
  }

  return (
    <Block padding={20} variant={'outlined'}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Ban size={18} />
          <Text weight={600}>{translateTravel('账号封禁管理')}</Text>
        </Flexbox>

        {isCurrentAdministrator && !user.banned ? (
          <Text color={'secondary'}>{translateTravel('不能封禁当前管理员账号')}</Text>
        ) : user.banned ? (
          confirmation === 'unban' ? (
            <Flexbox
              aria-describedby={dialogDescriptionId}
              aria-labelledby={dialogTitleId}
              gap={10}
              role={'alertdialog'}
            >
              <Text id={dialogTitleId} weight={600}>
                {translateTravel('确认解除该用户的封禁状态？')}
              </Text>
              <Text color={'secondary'} id={dialogDescriptionId}>
                {translateTravel('解除后，该用户将恢复访问平台。')}
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
                  {translateTravel('取消')}
                </Button>
                <Button
                  disabled={isMutating}
                  loading={activeAction === 'unban' || unbanMutation.isPending}
                  onClick={submitUnban}
                >
                  {translateTravel('确认解除封禁')}
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
              {translateTravel('恢复用户 / 解除封禁')}
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
              {suspending
                ? translateTravel('确认暂停该用户？')
                : translateTravel('确认封禁该用户？')}
            </Text>
            <Text color={'secondary'} id={dialogDescriptionId}>
              {translateTravel(
                '封禁后用户将无法继续使用平台。客户端仅辅助检查常见敏感信息，理由仍只能记录最小必要的处置依据。',
              )}
            </Text>
            <Field label={translateTravel('封禁理由')}>
              <TextArea
                aria-label={translateTravel('封禁理由')}
                autoSize={{ minRows: 2 }}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </Field>
            <Field label={translateTravel('封禁到期时间（可选）')}>
              <Input
                aria-label={translateTravel('封禁到期时间')}
                type={'datetime-local'}
                value={banExpires}
                onChange={(event) => setBanExpires(event.currentTarget.value)}
              />
            </Field>
            <Text color={'secondary'} fontSize={12}>
              {translateTravel('按当前设备本地时区填写，提交时转为同一时刻。')}
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
                {translateTravel('取消')}
              </Button>
              <Button
                danger
                disabled={isMutating}
                loading={activeAction === 'ban' || banMutation.isPending}
                onClick={submitBan}
              >
                {suspending ? translateTravel('确认暂停用户') : translateTravel('确认封禁用户')}
              </Button>
            </Flexbox>
          </Flexbox>
        ) : (
          <Flexbox horizontal gap={8} wrap={'wrap'}>
            <Button
              danger
              disabled={isMutating}
              onClick={() => {
                setSuspending(false);
                setConfirmation('ban');
                setError('');
              }}
            >
              {translateTravel('封禁用户')}
            </Button>
            <Button
              disabled={isMutating}
              onClick={() => {
                setSuspending(true);
                setReason('管理员暂停用户，禁止登录和使用 AI，待管理员恢复');
                setBanExpires('');
                setConfirmation('ban');
                setError('');
              }}
            >
              {translateTravel('暂停用户')}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    </Block>
  );
};

const ServiceOperations = () => {
  const translateTravel = useTravelTranslation();
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const [workspace, setWorkspace] = useState<ServiceOperationsWorkspace>('customers');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [creditPagination, setCreditPagination] = useState({ userId: '', page: 0 });
  const creditPage = creditPagination.userId === selectedUserId ? creditPagination.page : 0;
  const [showDetails, setShowDetails] = useState(false);
  const [customerDetailTab, setCustomerDetailTab] = useState<CustomerDetailTab>('overview');
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
  const selectedUserDetailsRef = useRef<HTMLDivElement>(null);

  const isContentModerationRoute = window.location.pathname.includes('content-moderation');

  useEffect(() => {
    if (isContentModerationRoute) {
      setWorkspace('moderation');
      return;
    }
    const requestedWorkspace = new URLSearchParams(window.location.search).get('workspace');
    if (
      requestedWorkspace === 'customers' ||
      requestedWorkspace === 'moderation' ||
      requestedWorkspace === 'template'
    ) {
      setWorkspace(requestedWorkspace);
    }
  }, [isContentModerationRoute]);

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
  const ledgerQuery = lambdaQuery.platformCredit.listUserEntries.useQuery(
    { limit: 11, offset: creditPage * 10, targetUserId: selectedUserId },
    { enabled: Boolean(selectedUserId), retry: false },
  );
  const ledgerEntries = ledgerQuery.data ?? [];
  const pendingReservationsQuery = lambdaQuery.platformCredit.listPendingReservations.useQuery(
    { limit: PENDING_RESERVATIONS_LIMIT, targetUserId: selectedUserId },
    { enabled: Boolean(selectedUserId), retry: false },
  );
  const pendingReservations = pendingReservationsQuery.data ?? [];
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
      setShowDetails(false);
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
  const reversibleEntryOptions = reversibleEntries.map((entry) => {
    const label = `${entryTypeLabel(entry.type)} · ${formatCredits(entry.amountCredits)} · ${entry.reason}`;
    return { label, title: label, value: entry.id };
  });

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
      ledgerQuery.refetch(),
      pendingReservationsQuery.refetch(),
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

  const revealUserDetails = (userId: string) => {
    setCustomerDetailTab(
      new URLSearchParams(window.location.search).get('section') === 'credits'
        ? 'credits'
        : 'overview',
    );
    setCreditPagination({ userId, page: 0 });
    setSelectedUserId(userId);
    setShowDetails(true);
    requestAnimationFrame(() =>
      selectedUserDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  const finishSuccessfulMutation = async (message: string) => {
    toast.success(message);
    try {
      await refreshSelectedUser();
    } catch {
      toast.error(translateTravel('操作已成功，但最新数据刷新失败，请手动刷新页面'));
    }
  };

  const validateReason = (reason: string) => {
    const trimmed = reason.trim();
    if (!trimmed) throw new OperationValidationError(translateTravel('请填写操作理由'));
    return trimmed;
  };

  const submitTopUp = async () => {
    try {
      if (!selectedUserId) throw new OperationValidationError(translateTravel('请先选择用户'));
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
      await finishSuccessfulMutation(translateTravel('充值已记入积分流水'));
    } catch (error) {
      const message =
        error instanceof OperationValidationError
          ? error.message
          : translateTravel('充值失败，请重试');
      setActionError(message);
      toast.error(message);
    }
  };

  const submitAdjustment = async () => {
    try {
      if (!selectedUserId) throw new OperationValidationError(translateTravel('请先选择用户'));
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
      await finishSuccessfulMutation(translateTravel('积分余额已调整'));
    } catch (error) {
      const message =
        error instanceof OperationValidationError
          ? error.message
          : translateTravel('调整失败，请重试');
      setActionError(message);
      toast.error(message);
    }
  };

  const submitReversal = async () => {
    try {
      if (!reversalEntryId) throw new OperationValidationError(translateTravel('请选择可冲正流水'));
      const reason = validateReason(reversalReason);
      const signature = `${reversalEntryId}\0${reason}`;
      const idempotencyKey = resolveRetryKey(reversalRetryKey, 'reversal', signature);
      setActionError('');
      await reversalMutation.mutateAsync({ entryId: reversalEntryId, idempotencyKey, reason });
      reversalRetryKey.current = null;
      setReversalReason('');
      await finishSuccessfulMutation(translateTravel('流水已冲正'));
    } catch (error) {
      const message =
        error instanceof OperationValidationError
          ? error.message
          : translateTravel('冲正失败，请重试');
      setActionError(message);
      toast.error(message);
    }
  };

  const runSearch = () => {
    setOffset(0);
    setQuery(searchInput.trim());
  };

  return (
    <Flexbox
      aria-label={translateTravel('账户管理内容')}
      className={`${styles.page} ${isContentModerationRoute ? '' : styles.customerPage}`}
      data-testid="service-operations-customer-page"
      gap={24}
      tabIndex={0}
      role="region"
      /* 高度随内容增长，纵向滚动由 Settings/Layout 外壳承担（网站式滚动，
         滚动条在页面最右缘）；本节点不再产生卡片内滚动条。 */
    >
      {/* 标题与说明已按要求移除，只保留“返回客户列表”这个功能入口 */}
      {!isContentModerationRoute && workspace === 'customers' && showDetails && selectedUser && (
        <Flexbox horizontal justify={'flex-end'}>
          <Button onClick={() => setShowDetails(false)}>{translateTravel('返回客户列表')}</Button>
        </Flexbox>
      )}

      {workspace === 'customers' && (
        <div className={styles.workspace}>
          {!showDetails && (
            <section aria-label={translateTravel('客户目录')} className={styles.directory}>
              <Flexbox gap={16}>
                <Flexbox gap={4}>
                  <Text as={'h3'} weight={600}>
                    {translateTravel('客户列表')}
                  </Text>
                  <Text color={'secondary'}>
                    {translateTravel('搜索并选择一位客户，查看其账号、群组、安全和积分资料。')}
                  </Text>
                </Flexbox>
                <Flexbox
                  horizontal
                  align={'end'}
                  className={styles.filterRow}
                  gap={8}
                  wrap={'wrap'}
                >
                  <Flexbox gap={6} style={{ flex: '1 1 280px' }}>
                    <Text as={'label'} fontSize={12} weight={500}>
                      {translateTravel('搜索用户')}
                    </Text>
                    <Input
                      aria-label={translateTravel('搜索用户')}
                      placeholder={translateTravel('姓名、用户名、邮箱或用户 ID')}
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') runSearch();
                      }}
                    />
                  </Flexbox>
                  <Button icon={<Search size={16} />} onClick={runSearch}>
                    {translateTravel('搜索')}
                  </Button>
                </Flexbox>

                {usersQuery.error ? (
                  <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                    <Alert title={translateTravel('用户列表暂时无法读取')} />
                    <Button onClick={() => void usersQuery.refetch()}>
                      {translateTravel('重试用户列表')}
                    </Button>
                  </Flexbox>
                ) : usersQuery.isLoading ? (
                  <Text color={'secondary'}>{translateTravel('正在读取用户…')}</Text>
                ) : users.length === 0 ? (
                  <Text color={'secondary'}>{translateTravel('没有匹配的用户')}</Text>
                ) : (
                  <div className={styles.customerTable}>
                    <table aria-label={translateTravel('客户列表')}>
                      <thead>
                        <tr>
                          <th>{translateTravel('姓名 / 用户名')}</th>
                          <th>{translateTravel('邮箱')}</th>
                          <th>{translateTravel('状态')}</th>
                          <th>{translateTravel('积分')}</th>
                          <th>{translateTravel('会话信息')}</th>
                          <th>{translateTravel('操作')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => {
                          const summary = summaries[user.id];
                          const displayName =
                            user.fullName || user.username || user.email || user.id;
                          return (
                            <tr
                              className={styles.customer}
                              data-selected={selectedUserId === user.id}
                              key={user.id}
                            >
                              <td>
                                <Flexbox horizontal align={'center'} gap={8}>
                                  <Text weight={600}>{displayName}</Text>
                                  {currentUserId === user.id && (
                                    <Tag>{translateTravel('当前用户')}</Tag>
                                  )}
                                </Flexbox>
                              </td>
                              <td>
                                <Text color={'secondary'}>
                                  {user.email || translateTravel('未填写邮箱')}
                                </Text>
                              </td>
                              <td>
                                <Tag color={user.banned ? 'red' : 'green'}>
                                  {user.banned
                                    ? translateTravel('已封禁')
                                    : translateTravel('正常')}
                                </Tag>
                              </td>
                              <td>
                                <Text weight={600}>{formatCredits(summary?.balanceCredits)}</Text>
                              </td>
                              <td>
                                <details>
                                  <summary>{translateTravel('会话信息')}</summary>
                                  <Flexbox gap={8}>
                                    <Text>{groupStatusLabel(summary?.groupReadiness)}</Text>
                                    <Text>
                                      {translateTravel('生成 {{v0}} 项', {
                                        v0: summary?.generationTotal ?? '—',
                                      })}
                                    </Text>
                                    <Text color={'secondary'}>
                                      {translateTravel('最近会话 IP：{{v0}}', {
                                        v0: user.latestSessionIp || translateTravel('无'),
                                      })}
                                    </Text>
                                    <Text color={'secondary'}>
                                      {translateTravel('最近会话：{{v0}}', {
                                        v0: formatDate(user.latestSessionAt),
                                      })}
                                    </Text>
                                    {user.banned && (
                                      <Text color={'secondary'}>
                                        {translateTravel('封禁原因：{{v0}}；到期：{{v1}}', {
                                          v0: formatBanReasonForDisplay(user.banReason),
                                          v1: formatDate(user.banExpires),
                                        })}
                                      </Text>
                                    )}
                                  </Flexbox>
                                </details>
                              </td>
                              <td>
                                <Button onClick={() => revealUserDetails(user.id)}>
                                  {selectedUserId === user.id
                                    ? translateTravel('已选择')
                                    : translateTravel('查看')}
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <Flexbox
                  horizontal
                  align={'center'}
                  className={styles.pagination}
                  gap={8}
                  justify={'space-between'}
                >
                  <Text className={styles.compactCount} color={'secondary'}>
                    {translateTravel('共 {{v0}} 位用户', { v0: total })}
                  </Text>
                  <Flexbox horizontal gap={8}>
                    <Button
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    >
                      {translateTravel('上一页')}
                    </Button>
                    <Button
                      disabled={offset + users.length >= total}
                      onClick={() => setOffset(offset + PAGE_SIZE)}
                    >
                      {translateTravel('下一页')}
                    </Button>
                  </Flexbox>
                </Flexbox>
              </Flexbox>
            </section>
          )}

          {showDetails && selectedUser && (
            <Flexbox
              className={styles.detail}
              gap={20}
              ref={selectedUserDetailsRef}
              style={{ scrollMarginBlockStart: 16 }}
            >
              <Flexbox gap={6}>
                <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                  <CheckCircle2 size={20} />
                  <Text as={'h3'} weight={600}>
                    {translateTravel('客户资料')}
                  </Text>
                  <Tag color={selectedUser.banned ? 'red' : 'green'}>
                    {selectedUser.banned ? translateTravel('已封禁') : translateTravel('账号正常')}
                  </Tag>
                </Flexbox>
                <Flexbox horizontal align={'center'} gap={16} wrap={'wrap'}>
                  <Flexbox horizontal align={'center'} gap={8}>
                    <UserRound
                      aria-hidden
                      size={16}
                      style={{ flexShrink: 0, color: cssVar.colorTextSecondary }}
                    />
                    <Text>
                      {translateTravel('用户名称：')}
                      <strong>
                        {selectedUser.fullName ||
                          selectedUser.username ||
                          selectedUser.email ||
                          selectedUser.id}
                      </strong>
                    </Text>
                  </Flexbox>
                  <Flexbox horizontal align={'center'} gap={8}>
                    <CalendarDays
                      aria-hidden
                      size={16}
                      style={{ flexShrink: 0, color: cssVar.colorTextSecondary }}
                    />
                    <Text color={'secondary'}>
                      {translateTravel('注册时间：{{v0}}', {
                        v0: formatDate(selectedUser.createdAt),
                      })}
                    </Text>
                  </Flexbox>
                  <Flexbox
                    horizontal
                    align={'center'}
                    gap={8}
                    title={translateTravel('按现存登录会话记录显示；会话被清除后可能无记录')}
                  >
                    <LogIn
                      aria-hidden
                      size={16}
                      style={{ flexShrink: 0, color: cssVar.colorTextSecondary }}
                    />
                    <Text color={'secondary'}>
                      {translateTravel('最后登录时间：{{v0}}', {
                        v0: selectedUser.latestLoginAt
                          ? formatDate(selectedUser.latestLoginAt)
                          : translateTravel('暂无记录'),
                      })}
                    </Text>
                  </Flexbox>
                </Flexbox>
                <Flexbox horizontal gap={16} wrap={'wrap'}>
                  <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
                    {selectedUser.phone ? (
                      <Phone
                        aria-hidden
                        size={16}
                        style={{ flexShrink: 0, color: cssVar.colorTextSecondary }}
                      />
                    ) : (
                      <Mail
                        aria-hidden
                        size={16}
                        style={{ flexShrink: 0, color: cssVar.colorTextSecondary }}
                      />
                    )}
                    <Text color={'secondary'}>
                      {selectedUser.phone
                        ? translateTravel('手机账号：{{v0}}', { v0: selectedUser.phone })
                        : translateTravel('邮箱账号：{{v0}}', {
                            v0: selectedUser.email || translateTravel('未填写邮箱'),
                          })}
                    </Text>
                  </Flexbox>
                  <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
                    <Fingerprint
                      aria-hidden
                      size={16}
                      style={{ flexShrink: 0, color: cssVar.colorTextSecondary }}
                    />
                    <Text color={'secondary'}>{`ID：${selectedUser.id}`}</Text>
                  </Flexbox>
                </Flexbox>
              </Flexbox>

              <Flexbox horizontal className={styles.metrics}>
                <Metric
                  icon={<WalletCards aria-hidden size={16} />}
                  label={translateTravel('积分账户')}
                  value={translateTravel('当前余额 {{v0}}', {
                    v0: formatCredits(accountQuery.data?.balanceCredits),
                  })}
                />
                <Metric
                  icon={<Users aria-hidden size={16} />}
                  label={translateTravel('私人超级群组')}
                  value={
                    overviewQuery.data
                      ? translateTravel('群组状态：{{v0}}', {
                          v0: groupStatusLabel(overviewQuery.data.travelGroup.readiness).replace(
                            translateTravel('群组'),
                            '',
                          ),
                        })
                      : translateTravel('读取中')
                  }
                />
                <Metric
                  icon={<Sparkles aria-hidden size={16} />}
                  label={translateTravel('生成管理')}
                  value={
                    overviewQuery.data
                      ? translateTravel('已记录 {{v0}} 项', {
                          v0: overviewQuery.data.generation.total,
                        })
                      : translateTravel('读取中')
                  }
                />
              </Flexbox>

              {(accountQuery.error || entriesQuery.error || overviewQuery.error) && (
                <Alert title={translateTravel('部分用户运营数据暂时无法读取')} />
              )}
              {actionError && <Alert title={actionError} />}

              <Tabs
                activeKey={customerDetailTab}
                className={styles.detailTabs}
                size={'large'}
                items={[
                  {
                    icon: <ContactRound size={16} />,
                    key: 'overview',
                    label: translateTravel('客户概览'),
                  },
                  {
                    icon: <Folders size={16} />,
                    key: 'groups',
                    label: translateTravel('群组与内容'),
                  },
                  {
                    icon: <ShieldCheck size={16} />,
                    key: 'security',
                    label: translateTravel('安全与会话'),
                  },
                  {
                    icon: <WalletCards size={16} />,
                    key: 'credits',
                    label: translateTravel('积分管理'),
                  },
                ]}
                onChange={(key) => setCustomerDetailTab(key as CustomerDetailTab)}
              />

              {customerDetailTab === 'overview' && (
                <Flexbox gap={16} role={'tabpanel'}>
                  <UserAccountControls
                    key={`account-${selectedUser.id}`}
                    user={selectedUser}
                    onChanged={refreshSelectedUser}
                    onDeleted={async () => {
                      setSelectedUserId('');
                      setShowDetails(false);
                      await usersQuery.refetch();
                    }}
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
                </Flexbox>
              )}

              {customerDetailTab === 'groups' && (
                <Flexbox gap={16} role={'tabpanel'}>
                  <UserPrivateGroupsSection
                    defaultGroup={overviewQuery.data?.travelGroup}
                    key={`private-groups-${selectedUser.id}-${summaryRevision}`}
                    userId={selectedUser.id}
                  />
                  <UserContentCatalogSection
                    filterInputs={contentFilterInputs}
                    key={`content-${selectedUser.id}`}
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
                </Flexbox>
              )}

              {customerDetailTab === 'security' && (
                <Flexbox gap={16} role={'tabpanel'}>
                  <UserBanControls
                    key={`${selectedUser.id}-${selectedUser.banned}`}
                    user={selectedUser}
                    onChanged={refreshSelectedUser}
                  />
                  <div className={styles.securitySummaryGrid}>
                    <UserAdminAuditSection
                      error={adminAuditQuery.error}
                      events={adminAuditQuery.data?.items ?? EMPTY_ADMIN_AUDIT_EVENTS}
                      loading={adminAuditQuery.isLoading}
                    />
                    <UserModerationSafetyOverviewSection
                      key={selectedUser.id}
                      userId={selectedUser.id}
                    />
                  </div>
                  <UserSessionOverviewSection
                    error={sessionOverviewQuery.error}
                    key={`sessions-${selectedUser.id}`}
                    loading={sessionOverviewQuery.isLoading}
                    overview={sessionOverviewQuery.data}
                    userId={selectedUser.id}
                    onChanged={refreshSelectedUser}
                  />
                </Flexbox>
              )}

              {customerDetailTab === 'credits' && (
                <Flexbox gap={16} role={'tabpanel'}>
                  <Block padding={16} variant={'outlined'}>
                    <Flexbox gap={16}>
                      <Flexbox horizontal align={'center'} gap={8}>
                        <WalletCards aria-hidden size={18} />
                        <Text weight={600}>{translateTravel('积分管理操作')}</Text>
                      </Flexbox>
                      <Text color={'secondary'}>
                        {translateTravel('积分仅接受安全整数，操作保留流水并防止重复入账。')}
                      </Text>
                      <Flexbox horizontal className={styles.creditActions} gap={20} wrap={'wrap'}>
                        <Flexbox className={styles.creditActionColumn} gap={12}>
                          <Flexbox horizontal align={'center'} gap={8}>
                            <CirclePlus aria-hidden size={18} />
                            <Text weight={600}>{translateTravel('管理员充值')}</Text>
                          </Flexbox>
                          <Field label={translateTravel('充值积分')}>
                            <Input
                              aria-label={translateTravel('充值积分')}
                              inputMode={'numeric'}
                              placeholder={translateTravel('例如：1000000')}
                              value={topUpCredits}
                              onChange={(event) => setTopUpCredits(event.currentTarget.value)}
                            />
                          </Field>
                          <Field label={translateTravel('充值理由')}>
                            <TextArea
                              aria-label={translateTravel('充值理由')}
                              autoSize={{ minRows: 2 }}
                              maxLength={500}
                              value={topUpReason}
                              onChange={(event) => setTopUpReason(event.currentTarget.value)}
                            />
                          </Field>
                          <Button loading={topUpMutation.isPending} onClick={submitTopUp}>
                            {translateTravel('确认充值')}
                          </Button>
                        </Flexbox>

                        <Flexbox className={styles.creditActionColumn} gap={12}>
                          <Flexbox horizontal align={'center'} gap={8}>
                            <SlidersHorizontal aria-hidden size={18} />
                            <Text weight={600}>{translateTravel('余额调整')}</Text>
                          </Flexbox>
                          <Field label={translateTravel('调整积分')}>
                            <Input
                              aria-label={translateTravel('调整积分')}
                              inputMode={'numeric'}
                              placeholder={translateTravel('正数增加，负数减少')}
                              value={adjustmentCredits}
                              onChange={(event) => setAdjustmentCredits(event.currentTarget.value)}
                            />
                          </Field>
                          <Field label={translateTravel('调整理由')}>
                            <TextArea
                              aria-label={translateTravel('调整理由')}
                              autoSize={{ minRows: 2 }}
                              maxLength={500}
                              value={adjustmentReason}
                              onChange={(event) => setAdjustmentReason(event.currentTarget.value)}
                            />
                          </Field>
                          <Button loading={adjustmentMutation.isPending} onClick={submitAdjustment}>
                            {translateTravel('确认调整')}
                          </Button>
                        </Flexbox>

                        <Flexbox className={styles.creditActionColumn} gap={12}>
                          <Flexbox horizontal align={'center'} gap={6}>
                            <Ban size={16} />
                            <Text weight={600}>{translateTravel('冲正流水')}</Text>
                          </Flexbox>
                          <Field label={translateTravel('冲正流水')}>
                            <Select
                              aria-label={translateTravel('冲正流水')}
                              classNames={{ value: styles.selectValue }}
                              disabled={reversibleEntries.length === 0}
                              options={reversibleEntryOptions}
                              value={reversalEntryId}
                              labelRender={(option) => (
                                <span className={styles.selectValue} title={option.title}>
                                  {option.label}
                                </span>
                              )}
                              onChange={setReversalEntryId}
                            />
                          </Field>
                          <Field label={translateTravel('冲正理由')}>
                            <TextArea
                              aria-label={translateTravel('冲正理由')}
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
                            {translateTravel('确认冲正')}
                          </Button>
                        </Flexbox>
                      </Flexbox>
                    </Flexbox>
                  </Block>

                  <Block padding={16} variant={'outlined'}>
                    <Flexbox gap={12}>
                      <Flexbox horizontal align={'center'} gap={8}>
                        <ShieldAlert aria-hidden size={18} />
                        <Text weight={600}>{translateTravel('待对账调用')}</Text>
                      </Flexbox>
                      <Text color={'secondary'}>
                        {translateTravel(
                          '仅显示已发往服务商但尚未完成本地结算的调用。没有权威服务商证据时，不提供释放、扣费或重试操作。',
                        )}
                      </Text>
                      {pendingReservationsQuery.isLoading ? (
                        <Text color={'secondary'}>{translateTravel('正在读取待对账调用…')}</Text>
                      ) : pendingReservationsQuery.error ? (
                        <Flexbox gap={8}>
                          <Text color={'secondary'}>
                            {translateTravel('待对账调用读取失败，请重试')}
                          </Text>
                          <Button onClick={() => pendingReservationsQuery.refetch()}>
                            {translateTravel('重试读取待对账调用')}
                          </Button>
                        </Flexbox>
                      ) : pendingReservations.length === 0 ? (
                        <Text color={'secondary'}>{translateTravel('暂无待对账调用')}</Text>
                      ) : (
                        pendingReservations.map((reservation) => (
                          <Block key={reservation.id} padding={12} variant={'outlined'}>
                            <Flexbox
                              horizontal
                              align={'center'}
                              className={styles.splitRow}
                              gap={12}
                              justify={'space-between'}
                              wrap={'wrap'}
                            >
                              <Flexbox gap={3} style={{ minWidth: 0 }}>
                                <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                                  <Tag
                                    color={
                                      reservation.status === 'provider_completed'
                                        ? 'gold'
                                        : 'orange'
                                    }
                                  >
                                    {pendingReservationStatusLabel(reservation.status)}
                                  </Tag>
                                  <Text weight={600}>
                                    {reservation.provider} / {reservation.model}
                                  </Text>
                                </Flexbox>
                                <Text color={'secondary'}>
                                  {reservation.providerRequestId
                                    ? translateTravel('服务商请求 ID：{{v0}}', {
                                        v0: reservation.providerRequestId,
                                      })
                                    : translateTravel('未捕获服务商请求 ID')}
                                </Text>
                                <Text color={'secondary'}>
                                  {translateTravel('生成记录：{{v0}}', {
                                    v0: reservation.generationId,
                                  })}
                                </Text>
                                <Text color={'secondary'}>
                                  {translateTravel('付款方：{{v0}} · 执行者：{{v1}}', {
                                    v0: reservation.payerUserId,
                                    v1: reservation.actorUserId,
                                  })}
                                </Text>
                              </Flexbox>
                              <Flexbox gap={3} style={{ textAlign: 'right' }}>
                                <Text weight={600}>
                                  {translateTravel('{{v0}} 积分预留', {
                                    v0: new Intl.NumberFormat(getTravelLocale()).format(
                                      reservation.reservedCredits,
                                    ),
                                  })}
                                </Text>
                                <Text color={'secondary'}>{formatDate(reservation.updatedAt)}</Text>
                              </Flexbox>
                            </Flexbox>
                          </Block>
                        ))
                      )}
                    </Flexbox>
                  </Block>

                  <Block padding={16} variant={'outlined'}>
                    <Flexbox gap={12}>
                      <Flexbox horizontal align={'center'} gap={8}>
                        <FileClock size={18} />
                        <Text weight={600}>{translateTravel('积分流水')}</Text>
                      </Flexbox>
                      {ledgerQuery.isLoading ? (
                        <Text color={'secondary'}>{translateTravel('正在读取流水…')}</Text>
                      ) : ledgerQuery.error ? (
                        <Flexbox gap={8}>
                          <Text color={'secondary'}>
                            {translateTravel('积分流水读取失败，请重试')}
                          </Text>
                          <Button onClick={() => ledgerQuery.refetch()}>
                            {translateTravel('重试读取积分流水')}
                          </Button>
                        </Flexbox>
                      ) : ledgerEntries.length === 0 ? (
                        <Text color={'secondary'}>{translateTravel('暂无积分流水')}</Text>
                      ) : (
                        ledgerEntries.slice(0, 10).map((entry) => (
                          <Block key={entry.id} padding={12} variant={'outlined'}>
                            <Flexbox
                              horizontal
                              align={'center'}
                              className={styles.splitRow}
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
                                  {translateTravel('{{v0}}{{v1}} 积分', {
                                    v0: entry.amountCredits > 0 ? '+' : '',
                                    v1: new Intl.NumberFormat(getTravelLocale()).format(
                                      entry.amountCredits,
                                    ),
                                  })}
                                </Text>
                                <Text color={'secondary'}>
                                  {translateTravel('余额 {{v0}}', {
                                    v0: formatCredits(entry.balanceAfterCredits),
                                  })}
                                </Text>
                              </Flexbox>
                            </Flexbox>
                          </Block>
                        ))
                      )}
                      {(creditPage > 0 || ledgerEntries.length > 10) && (
                        <Flexbox
                          horizontal
                          align={'center'}
                          className={styles.pagination}
                          gap={12}
                          justify={'space-between'}
                          wrap={'wrap'}
                        >
                          <Button
                            aria-label={translateTravel('积分流水上一页')}
                            disabled={creditPage === 0 || ledgerQuery.isLoading}
                            onClick={() =>
                              setCreditPagination({ userId: selectedUserId, page: creditPage - 1 })
                            }
                          >
                            {translateTravel('上一页')}
                          </Button>
                          <Text color={'secondary'}>
                            {translateTravel('第 {{v0}} 页 · 每页 10 条', { v0: creditPage + 1 })}
                          </Text>
                          <Button
                            aria-label={translateTravel('积分流水下一页')}
                            disabled={
                              ledgerEntries.length <= 10 ||
                              ledgerQuery.isLoading ||
                              Boolean(ledgerQuery.error)
                            }
                            onClick={() =>
                              setCreditPagination({ userId: selectedUserId, page: creditPage + 1 })
                            }
                          >
                            {translateTravel('下一页')}
                          </Button>
                        </Flexbox>
                      )}
                    </Flexbox>
                  </Block>
                </Flexbox>
              )}
            </Flexbox>
          )}
        </div>
      )}

      {workspace === 'moderation' && <ModerationSection />}
      {workspace === 'template' && (
        <Block padding={20} variant="outlined">
          <Flexbox gap={12}>
            <Text as="h3" weight={600}>
              {translateTravel('成员配置已移至超级工作群')}
            </Text>
            <Text type="secondary">
              {translateTravel(
                '请在群内打开成员列表，添加已有成员、编辑原配置或删除成员。管理员确认后同步所有用户的默认群。',
              )}
            </Text>
            <a href={withLobeHubMountPath('/')}>{translateTravel('前往我的超级工作群')}</a>
          </Flexbox>
        </Block>
      )}
    </Flexbox>
  );
};

export default ServiceOperations;
