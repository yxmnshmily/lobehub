import type * as BaseUI from '@lobehub/ui/base-ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Namespace } from 'i18next';
import i18n from 'i18next';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import zhCommon from '../../../../locales/zh-CN/common.json';
import ManagedDeleteControl from './ManagedDeleteControl';
import ServiceOperations from './ServiceOperations';

// This suite checks rendered account values, so use real translations and interpolation.
// The global key-passthrough mock leaves {{v0}} placeholders unresolved.
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: (namespace: Namespace = 'common') => ({
    i18n,
    t: i18n.getFixedT('zh-CN', namespace),
  }),
}));

vi.mock('./SuperGroupTemplateSection', () => ({ default: () => null }));

const mocks = vi.hoisted(() => ({
  adjust: vi.fn(),
  auditEventsRefetch: vi.fn(),
  banUser: vi.fn(),
  clearModeration: vi.fn(),
  currentUserId: vi.fn(),
  forceUserPasswordReset: vi.fn(),
  setUserPassword: vi.fn(),
  deleteUser: vi.fn(),
  getModerationRecordQuery: vi.fn(),
  getUserSafetyOverviewQuery: vi.fn(),
  getUserAccount: vi.fn(),
  getUserAccountQuery: vi.fn(),
  getUserContentCatalogQuery: vi.fn(),
  getUserOverview: vi.fn(),
  getUserOverviewQuery: vi.fn(),
  getUserPrivateGroupMembersQuery: vi.fn(),
  getUserSessionOverviewQuery: vi.fn(),
  getUserSummariesQuery: vi.fn(),
  getUserTravelGroupHealthOverviewQuery: vi.fn(),
  privateGroupMembersRefetch: vi.fn(),
  privateGroupsRefetch: vi.fn(),
  pendingReservationsRefetch: vi.fn(),
  userAccountRefetch: vi.fn(),
  userEntriesRefetch: vi.fn(),
  userOverviewRefetch: vi.fn(),
  userSummariesRefetch: vi.fn(),
  usersRefetch: vi.fn(),
  listUserEntriesQuery: vi.fn(),
  listPendingReservationsQuery: vi.fn(),
  listModerationRecordsQuery: vi.fn(),
  listAuditEventsQuery: vi.fn(),
  listUserPrivateGroupsQuery: vi.fn(),
  listUsersQuery: vi.fn(),
  markModerationReviewed: vi.fn(),
  moderationDetailRefetch: vi.fn(),
  moderationListRefetch: vi.fn(),
  contentCatalogRefetch: vi.fn(),
  recommendModerationBan: vi.fn(),
  repairUserTravelGroup: vi.fn(),
  reverse: vi.fn(),
  revokeUserSessions: vi.fn(),
  sessionOverviewRefetch: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  topUp: vi.fn(),
  travelGroupHealthRefetch: vi.fn(),
  unbanUser: vi.fn(),
  updateUserProfile: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({
    children,
    padding: _padding,
    variant: _variant,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { padding?: number; variant?: string }) => (
    <div {...props}>{children}</div>
  ),
  Flexbox: ({
    align: _align,
    children,
    gap: _gap,
    horizontal: _horizontal,
    justify: _justify,
    wrap: _wrap,
    ...props
  }: HTMLAttributes<HTMLDivElement> & {
    align?: string;
    gap?: number;
    horizontal?: boolean;
    justify?: string;
    wrap?: string;
  }) => <div {...props}>{children}</div>,
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Tabs: ({
    activeKey,
    className,
    items,
    onChange,
    size: _size,
  }: {
    activeKey: string;
    className?: string;
    items: { icon?: ReactNode; key: string; label: ReactNode }[];
    onChange: (key: string) => void;
    size?: string;
  }) => (
    <div className={className} role="tablist">
      {items.map((item) => (
        <button
          aria-selected={activeKey === item.key}
          key={item.key}
          role="tab"
          onClick={() => onChange(item.key)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  ),
  TextArea: ({
    autoSize: _autoSize,
    ...props
  }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { autoSize?: unknown }) => (
    <textarea {...props} />
  ),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof BaseUI>()),
  Alert: ({ title }: { title: ReactNode }) => <div role="alert">{title}</div>,
  Button: ({
    children,
    danger: _danger,
    icon: _icon,
    loading: _loading,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    danger?: boolean;
    icon?: ReactNode;
    loading?: boolean;
  }) => <button {...props}>{children}</button>,
  Select: ({
    'aria-label': ariaLabel,
    classNames,
    disabled,
    labelRender,
    onChange,
    options = [],
    value,
  }: {
    'aria-label'?: string;
    'classNames'?: { value?: string };
    'disabled'?: boolean;
    'labelRender'?: (option: { label: string; title?: string; value: string }) => ReactNode;
    'onChange'?: (value: string) => void;
    'options'?: { label: string; title?: string; value: string }[];
    'value'?: string;
  }) => {
    const selectedOption = options.find((option) => option.value === value);

    return (
      <>
        <select
          aria-label={ariaLabel}
          disabled={disabled}
          value={value || ''}
          onChange={(event) => onChange?.(event.currentTarget.value)}
        >
          <option value="" />
          {options.map((option) => (
            <option key={option.value} title={option.title} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {selectedOption && labelRender && (
          <span className={classNames?.value}>{labelRender(selectedOption)}</span>
        )}
      </>
    );
  },
  Tag: ({ children, color }: { children: ReactNode; color?: string }) => (
    <span data-color={color}>{children}</span>
  ),
  Text: ({
    as: Component = 'span',
    children,
    color: _color,
    fontSize: _fontSize,
    type: _type,
    weight: _weight,
    ...props
  }: any) => <Component {...props}>{children}</Component>,
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    platformCredit: { getUserAccount: { query: mocks.getUserAccount } },
    platformOperations: { getUserOverview: { query: mocks.getUserOverview } },
  },
  lambdaQuery: {
    platformCredit: {
      adjust: { useMutation: () => ({ isPending: false, mutateAsync: mocks.adjust }) },
      getUserAccount: { useQuery: mocks.getUserAccountQuery },
      listPendingReservations: { useQuery: mocks.listPendingReservationsQuery },
      listUserEntries: { useQuery: mocks.listUserEntriesQuery },
      reverse: { useMutation: () => ({ isPending: false, mutateAsync: mocks.reverse }) },
      topUp: { useMutation: () => ({ isPending: false, mutateAsync: mocks.topUp }) },
    },
    platformOperations: {
      banUser: { useMutation: () => ({ isPending: false, mutateAsync: mocks.banUser }) },
      forceUserPasswordReset: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.forceUserPasswordReset }),
      },
      setUserPassword: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.setUserPassword }),
      },
      deleteUser: { useMutation: () => ({ isPending: false, mutateAsync: mocks.deleteUser }) },
      getUserOverview: { useQuery: mocks.getUserOverviewQuery },
      getUserContentCatalog: { useQuery: mocks.getUserContentCatalogQuery },
      getUserPrivateGroupMembers: { useQuery: mocks.getUserPrivateGroupMembersQuery },
      getUserSessionOverview: { useQuery: mocks.getUserSessionOverviewQuery },
      getUserSummaries: { useQuery: mocks.getUserSummariesQuery },
      getUserTravelGroupHealthOverview: {
        useQuery: mocks.getUserTravelGroupHealthOverviewQuery,
      },
      listAuditEvents: { useQuery: mocks.listAuditEventsQuery },
      listUserPrivateGroups: { useQuery: mocks.listUserPrivateGroupsQuery },
      listUsers: { useQuery: mocks.listUsersQuery },
      repairUserTravelGroup: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.repairUserTravelGroup }),
      },
      revokeUserSessions: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.revokeUserSessions }),
      },
      unbanUser: { useMutation: () => ({ isPending: false, mutateAsync: mocks.unbanUser }) },
      updateUserProfile: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.updateUserProfile }),
      },
    },
    platformModeration: {
      clear: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.clearModeration }),
      },
      getRecord: { useQuery: mocks.getModerationRecordQuery },
      getUserSafetyOverview: { useQuery: mocks.getUserSafetyOverviewQuery },
      listRecords: { useQuery: mocks.listModerationRecordsQuery },
      markReviewed: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.markModerationReviewed }),
      },
      recommendBan: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.recommendModerationBan }),
      },
    },
    travelServiceLedger: {
      adminCreateOrder: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      adminListAccounts: {
        useQuery: () => ({ data: [], error: null, isLoading: false, refetch: vi.fn() }),
      },
      adminListEntries: {
        useQuery: () => ({ data: [], error: null, isLoading: false, refetch: vi.fn() }),
      },
      adminListOrders: {
        useQuery: () => ({ data: [], error: null, isLoading: false, refetch: vi.fn() }),
      },
      adminPostManualEntry: {
        useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
      },
      adminReverseEntry: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
    },
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: mocks.currentUserId() } }),
}));

const userRow = {
  avatar: null,
  banExpires: null,
  banned: false,
  banReason: null,
  createdAt: new Date('2026-09-02T06:00:00.000Z'),
  email: 'zhang@example.com',
  emailVerified: true,
  fullName: '张三',
  id: 'customer-zhang',
  lastActiveAt: new Date('2026-09-02T09:00:00.000Z'),
  latestSessionAt: new Date('2026-09-02T09:00:00.000Z'),
  latestSessionIp: '198.51.100.24',
  travelServiceLedger: { balanceFen: 1234, currency: 'CNY', totalConsumptionFen: 800 },
  username: 'zhangsan',
};

it.each([
  [null, 'zhang@example.com', '邮箱账号：zhang@example.com'],
  ['13800138000', 'phone-user@phone.invalid', '手机账号：13800138000'],
])('labels the actual customer account type: %s', async (phone, email, expected) => {
  mocks.listUsersQuery.mockReturnValue({
    data: { items: [{ ...userRow, phone, email }], limit: 20, offset: 0, total: 1 },
    isLoading: false,
    error: null,
    refetch: mocks.usersRefetch,
  });
  render(<ServiceOperations />);
  await userEvent.click(await screen.findByRole('button', { name: '已选择' }));
  expect(await screen.findByText(expected)).toBeInTheDocument();
  expect(screen.queryByText(/邮箱账号（手机号\/微信号）/)).not.toBeInTheDocument();
});

const overview = {
  generation: { statusCounts: [{ count: 3, status: 'succeeded' }], total: 3 },
  recentDocuments: [],
  recentWorks: [],
  travelGroup: {
    expectedMemberCount: 5,
    id: 'travel-group-zhang',
    memberCount: 5,
    readiness: 'ready',
    ready: true,
    supervisorCount: 1,
    title: '旅游服务超级群组',
    updatedAt: new Date('2026-09-02T08:00:00.000Z'),
  },
};

const creditEntry = {
  amountCredits: 1_000_000,
  balanceAfterCredits: 1_000_000,
  costUsd: '0.002',
  createdAt: new Date('2026-09-02T07:00:00.000Z'),
  generationId: 'generation-sensitive-id',
  generationType: null,
  id: '11111111-1111-4111-8111-111111111111',
  model: 'internal-model-name',
  provider: 'internal-provider-name',
  reason: '首次充值',
  reversalOfEntryId: null,
  type: 'top_up',
  updatedAt: new Date('2026-09-02T07:00:00.000Z'),
};

const pendingReservation = {
  actorUserId: userRow.id,
  callKind: 'call_llm',
  createdAt: new Date('2026-09-02T08:00:00.000Z'),
  expiresAt: new Date('2026-09-02T08:05:00.000Z'),
  generationId: 'pending-generation-safe-id',
  generationType: 'agent-runtime-text-step',
  id: '44444444-4444-4444-8444-444444444444',
  model: 'deepseek-chat',
  payerUserId: userRow.id,
  provider: 'deepseek',
  providerRequestId: null,
  reservedCredits: 2_961_629,
  settledCredits: 0,
  status: 'provider_started',
  updatedAt: new Date('2026-09-02T08:01:00.000Z'),
};

const moderationRecord = {
  categories: [{ category: 'credential', count: 1, severity: 'critical' }],
  detectedAt: new Date('2026-09-02T10:00:00.000Z'),
  disposedAt: null,
  disposition: 'pending',
  id: '22222222-2222-4222-8222-222222222222',
  operatorUserId: null,
  sourceId: 'source-opaque-id',
  sourceType: 'copy',
  userId: 'customer-zhang',
  verdict: 'block',
};

const moderationDetail = {
  ...moderationRecord,
  fingerprint: 'a'.repeat(64),
  redactedPreview: '[CREDENTIAL]',
};

const userSafetyOverview = {
  items: [
    {
      categories: [{ category: 'credential', count: 1, severity: 'critical' }],
      detectedAt: new Date('2026-09-02T10:00:00.000Z'),
      disposedAt: null,
      disposition: 'pending',
      id: '33333333-3333-4333-8333-333333333333',
      message: 'SAFETY_MESSAGE_MUST_NOT_RENDER',
      prompt: 'SAFETY_PROMPT_MUST_NOT_RENDER',
      providerKey: 'SAFETY_PROVIDER_KEY_MUST_NOT_RENDER',
      sourceId: 'SAFETY_SOURCE_ID_MUST_NOT_RENDER',
      sourceType: 'copy',
      token: 'SAFETY_TOKEN_MUST_NOT_RENDER',
      verdict: 'block',
    },
  ],
  nextCursor: 'opaque-safety-cursor',
  summary: {
    allow: 0,
    banRecommended: 0,
    block: 1,
    cleared: 0,
    pending: 1,
    review: 0,
    reviewed: 0,
    total: 1,
  },
};

const adminAuditEvent = {
  action: 'user.profile_updated',
  emailBody: 'AUDIT_EMAIL_BODY_MUST_NOT_RENDER',
  ipAddress: '203.0.113.99',
  metadata: { secret: 'AUDIT_METADATA_MUST_NOT_RENDER' },
  occurredAt: new Date('2026-09-02T11:00:00.000Z'),
  operationId: 'platform-operation-safe-id',
  operatorUserId: 'platform-admin-operator',
  password: 'AUDIT_PASSWORD_MUST_NOT_RENDER',
  phase: 'succeeded',
  targetUserId: userRow.id,
  token: 'AUDIT_TOKEN_MUST_NOT_RENDER',
};

const sessionOverview = {
  items: [
    {
      cookie: 'SESSION_COOKIE_MUST_NOT_RENDER',
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
      emailBody: 'SESSION_EMAIL_BODY_MUST_NOT_RENDER',
      expiresAt: new Date('2027-09-02T08:00:00.000Z'),
      ipAddress: '198.51.100.88',
      password: 'SESSION_PASSWORD_MUST_NOT_RENDER',
      providerKey: 'SESSION_PROVIDER_KEY_MUST_NOT_RENDER',
      token: 'SESSION_TOKEN_MUST_NOT_RENDER',
      updatedAt: new Date('2026-09-02T09:30:00.000Z'),
      userAgent: 'Safari 19 / macOS',
    },
  ],
  nextCursor: 'opaque-next-cursor',
  total: 3,
};

const privateGroupHealthOverview = {
  actionCounts: [
    { code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED', count: 1 },
    { code: 'SUPERVISOR_REVIEW_REQUIRED', count: 1 },
    { code: 'UNKNOWN_ISSUE_REVIEW_REQUIRED', count: 1 },
  ],
  canRepair: false,
  issueCodes: [
    'DEFAULT_GROUP_DUPLICATED',
    'DEFAULT_GROUP_NOT_PRIVATE',
    'SUPERVISOR_COUNT_INVALID',
    'SUPERVISOR_TITLE_INVALID',
    'SUPERVISOR_NOT_PLATFORM_MANAGED',
    'COPYWRITER_MISSING',
    'COPYWRITER_DISABLED',
    'COPYWRITER_NOT_PLATFORM_MANAGED',
    'DESIGNER_MISSING',
    'DESIGNER_DISABLED',
    'DESIGNER_NOT_PLATFORM_MANAGED',
    'VIDEO_PRODUCER_MISSING',
    'VIDEO_PRODUCER_DISABLED',
    'VIDEO_PRODUCER_NOT_PLATFORM_MANAGED',
    'DOCUMENT_ASSISTANT_MISSING',
    'DOCUMENT_ASSISTANT_DISABLED',
    'DOCUMENT_ASSISTANT_NOT_PLATFORM_MANAGED',
  ],
  memberDetails: 'GROUP_MEMBER_DETAILS_MUST_NOT_RENDER',
  model: 'GROUP_MODEL_MUST_NOT_RENDER',
  prompt: 'GROUP_PROMPT_MUST_NOT_RENDER',
  providerKey: 'GROUP_PROVIDER_KEY_MUST_NOT_RENDER',
  planFingerprint: 'f'.repeat(64),
  ready: false,
  reviewRequired: true,
  systemRole: 'GROUP_SYSTEM_ROLE_MUST_NOT_RENDER',
};

const privateGroupCatalog = {
  items: [
    {
      avatar: null,
      clientId: 'default-travel-service-group',
      config: 'PRIVATE_GROUP_CONFIG_MUST_NOT_RENDER',
      createdAt: new Date('2026-09-02T06:00:00.000Z'),
      description: '客户私人旅游服务群',
      id: overview.travelGroup.id,
      model: 'PRIVATE_GROUP_MODEL_MUST_NOT_RENDER',
      provider: 'PRIVATE_GROUP_PROVIDER_MUST_NOT_RENDER',
      systemPrompt: 'PRIVATE_GROUP_PROMPT_MUST_NOT_RENDER',
      title: '旅游服务超级群组',
      updatedAt: new Date('2026-09-02T08:00:00.000Z'),
    },
  ],
  nextCursor: 'private-groups-next-cursor',
};

const privateGroupMembers = {
  items: [
    {
      agentId: 'travel-owner-agent',
      avatar: null,
      clientId: 'travel-owner-client',
      config: 'PRIVATE_MEMBER_CONFIG_MUST_NOT_RENDER',
      description: '负责识别需求并协调旅游助理',
      enabled: true,
      model: 'PRIVATE_MEMBER_MODEL_MUST_NOT_RENDER',
      name: '旅游群主AI',
      order: 0,
      provider: 'PRIVATE_MEMBER_PROVIDER_MUST_NOT_RENDER',
      role: 'supervisor',
      systemRole: 'PRIVATE_MEMBER_PROMPT_MUST_NOT_RENDER',
    },
    {
      agentId: 'travel-copy-agent',
      avatar: null,
      clientId: 'travel-copy-client',
      description: '生成旅游文案',
      enabled: false,
      name: '旅游文案助理',
      order: 1,
      role: 'participant',
    },
  ],
  nextCursor: 'private-members-next-cursor',
};

const contentCounts = { documents: 1, generationTasks: 3, works: 1 };
const contentCatalogs = {
  document: {
    counts: contentCounts,
    items: [
      {
        content: 'CONTENT_DOCUMENT_BODY_MUST_NOT_RENDER',
        createdAt: new Date('2026-09-02T06:00:00.000Z'),
        filename: '西藏行程.md',
        id: 'content-document-safe-id',
        kind: 'document',
        metadata: { token: 'CONTENT_DOCUMENT_METADATA_MUST_NOT_RENDER' },
        status: null,
        title: '西藏行程摘要',
        type: 'text/markdown',
        updatedAt: new Date('2026-09-02T09:00:00.000Z'),
      },
    ],
    nextCursor: null,
  },
  generation: {
    counts: contentCounts,
    items: [
      {
        createdAt: new Date('2026-09-02T07:00:00.000Z'),
        filename: null,
        id: 'content-generation-safe-id',
        internalError: 'CONTENT_INTERNAL_ERROR_MUST_NOT_RENDER',
        kind: 'generation',
        prompt: 'CONTENT_PROMPT_MUST_NOT_RENDER',
        provider: 'CONTENT_PROVIDER_MUST_NOT_RENDER',
        providerKey: 'CONTENT_PROVIDER_KEY_MUST_NOT_RENDER',
        status: 'succeeded',
        title: null,
        type: 'copy',
        updatedAt: new Date('2026-09-02T10:00:00.000Z'),
        usage: { input: 123_456 },
      },
    ],
    nextCursor: 'opaque-generation-cursor',
  },
  work: {
    counts: contentCounts,
    items: [
      {
        createdAt: new Date('2026-09-02T06:30:00.000Z'),
        description: 'CONTENT_WORK_BODY_MUST_NOT_RENDER',
        filename: null,
        id: 'content-work-safe-id',
        kind: 'work',
        status: 'completed',
        title: '川藏线作品',
        type: 'document',
        updatedAt: new Date('2026-09-02T09:30:00.000Z'),
        url: 'CONTENT_WORK_URL_MUST_NOT_RENDER',
      },
    ],
    nextCursor: null,
  },
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

beforeEach(async () => {
  i18n.addResourceBundle('zh-CN', 'common', zhCommon, true, true);
  await i18n.changeLanguage('zh-CN');
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  mocks.currentUserId.mockReturnValue('platform-admin-self');
  mocks.listUsersQuery.mockReturnValue({
    data: { items: [userRow], limit: 20, offset: 0, total: 1 },
    error: null,
    isLoading: false,
    refetch: mocks.usersRefetch,
  });
  mocks.getUserAccount.mockResolvedValue({ balanceCredits: 1_000_000 });
  mocks.getUserOverview.mockResolvedValue(overview);
  mocks.getUserAccountQuery.mockReturnValue({
    data: { balanceCredits: 1_000_000 },
    error: null,
    isLoading: false,
    refetch: mocks.userAccountRefetch,
  });
  mocks.getUserOverviewQuery.mockReturnValue({
    data: overview,
    error: null,
    isLoading: false,
    refetch: mocks.userOverviewRefetch,
  });
  mocks.getUserSummariesQuery.mockReturnValue({
    data: {
      items: [
        {
          balanceCredits: 1_000_000,
          generationTotal: 3,
          groupReadiness: 'ready',
          userId: userRow.id,
        },
      ],
    },
    error: null,
    isLoading: false,
    refetch: mocks.userSummariesRefetch,
  });
  mocks.listUserPrivateGroupsQuery.mockReturnValue({
    data: privateGroupCatalog,
    error: null,
    isLoading: false,
    refetch: mocks.privateGroupsRefetch,
  });
  mocks.getUserPrivateGroupMembersQuery.mockReturnValue({
    data: privateGroupMembers,
    error: null,
    isLoading: false,
    refetch: mocks.privateGroupMembersRefetch,
  });
  mocks.getUserContentCatalogQuery.mockImplementation(
    (input: { kind: keyof typeof contentCatalogs }) => ({
      data: contentCatalogs[input.kind],
      error: null,
      isLoading: false,
      refetch: mocks.contentCatalogRefetch,
    }),
  );
  mocks.getUserSessionOverviewQuery.mockReturnValue({
    data: sessionOverview,
    error: null,
    isLoading: false,
    refetch: mocks.sessionOverviewRefetch,
  });
  mocks.getUserSafetyOverviewQuery.mockReturnValue({
    data: userSafetyOverview,
    error: null,
    isLoading: false,
  });
  mocks.getUserTravelGroupHealthOverviewQuery.mockReturnValue({
    data: privateGroupHealthOverview,
    error: null,
    isLoading: false,
    refetch: mocks.travelGroupHealthRefetch,
  });
  mocks.listUserEntriesQuery.mockReturnValue({
    data: [creditEntry],
    error: null,
    isLoading: false,
    refetch: mocks.userEntriesRefetch,
  });
  mocks.listPendingReservationsQuery.mockReturnValue({
    data: [pendingReservation],
    error: null,
    isLoading: false,
    refetch: mocks.pendingReservationsRefetch,
  });
  mocks.listModerationRecordsQuery.mockReturnValue({
    data: { items: [moderationRecord], limit: 20, offset: 0, total: 1 },
    error: null,
    isLoading: false,
    refetch: mocks.moderationListRefetch,
  });
  mocks.listAuditEventsQuery.mockReturnValue({
    data: { items: [adminAuditEvent], nextCursor: null },
    error: null,
    isLoading: false,
    refetch: mocks.auditEventsRefetch,
  });
  mocks.getModerationRecordQuery.mockImplementation(
    (_input: unknown, options?: { enabled?: boolean }) => ({
      data: options?.enabled ? moderationDetail : undefined,
      error: null,
      isLoading: false,
      refetch: mocks.moderationDetailRefetch,
    }),
  );
  mocks.topUp.mockResolvedValue(creditEntry);
  mocks.adjust.mockResolvedValue(creditEntry);
  mocks.reverse.mockResolvedValue({ ...creditEntry, type: 'reversal' });
  mocks.banUser.mockResolvedValue({
    banExpires: null,
    banned: true,
    banReason: '多次违反使用规则',
    id: userRow.id,
  });
  mocks.unbanUser.mockResolvedValue({
    banExpires: null,
    banned: false,
    banReason: null,
    id: userRow.id,
  });
  mocks.updateUserProfile.mockResolvedValue({
    avatar: 'https://example.com/new-avatar.png',
    fullName: '张三·更新',
    id: userRow.id,
  });
  mocks.forceUserPasswordReset.mockResolvedValue({ id: userRow.id, resetRequested: true });
  mocks.revokeUserSessions.mockResolvedValue({ id: userRow.id, sessionsRevoked: true });
  mocks.repairUserTravelGroup.mockResolvedValue({
    actionCounts: [{ code: 'SET_PRIVATE', count: 1 }],
    ready: true,
    reviewRequired: false,
  });
  mocks.clearModeration.mockResolvedValue({ ...moderationDetail, disposition: 'cleared' });
  mocks.markModerationReviewed.mockResolvedValue({
    ...moderationDetail,
    disposition: 'reviewed',
  });
  mocks.recommendModerationBan.mockResolvedValue({
    ...moderationDetail,
    disposition: 'ban_recommended',
  });
});

const openCustomerTab = async (name: '积分管理' | '安全与会话' | '群组与内容') => {
  const user = userEvent.setup();
  if (!screen.queryByRole('tab', { name })) {
    await user.click(await screen.findByRole('button', { name: '已选择' }));
  }
  await user.click(await screen.findByRole('tab', { name }));
};

describe('ServiceOperations', () => {
  it('marks the signed-in account independently of the selected customer', async () => {
    const signedInUser = {
      ...userRow,
      id: 'platform-admin-self',
      fullName: '管理员',
      email: 'admin@example.com',
    };
    mocks.listUsersQuery.mockReturnValue({
      data: { items: [userRow, signedInUser], limit: 20, offset: 0, total: 2 },
      error: null,
      isLoading: false,
      refetch: mocks.usersRefetch,
    });
    render(<ServiceOperations />);
    const customerRow = (await screen.findByText(userRow.email)).closest('tr')!;
    const adminRow = screen.getByText(signedInUser.email).closest('tr')!;
    expect(within(customerRow).queryByText('当前用户')).not.toBeInTheDocument();
    expect(within(adminRow).getByText('当前用户')).toBeInTheDocument();
    await userEvent.click(within(adminRow).getByRole('button', { name: '查看' }));
    await userEvent.click(await screen.findByRole('button', { name: '返回客户列表' }));
    expect(
      within(screen.getByText(signedInUser.email).closest('tr')!).getByText('当前用户'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText(userRow.email).closest('tr')!).queryByText('当前用户'),
    ).not.toBeInTheDocument();
  });

  it('shows registration and last login times in customer details', async () => {
    render(<ServiceOperations />);
    await userEvent.click(await screen.findByRole('button', { name: '已选择' }));
    expect(screen.getByText(/^注册时间：/)).toBeInTheDocument();
    expect(screen.getByText(/^最后登录时间：/)).toBeInTheDocument();
  });
  it('paginates credit entries ten at a time', async () => {
    mocks.listUserEntriesQuery.mockImplementation(({ limit, offset = 0 }) => ({
      data: Array.from({ length: 21 }, (_, index) => ({
        ...creditEntry,
        id: `entry-${index}`,
        reason: `流水记录-${index}`,
      })).slice(offset, offset + limit),
      error: null,
      isLoading: false,
      refetch: mocks.userEntriesRefetch,
    }));
    render(<ServiceOperations />);
    await openCustomerTab('积分管理');
    expect(screen.getByText('流水记录-9')).toBeInTheDocument();
    expect(screen.queryByText('流水记录-10')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '积分流水下一页' }));
    expect(screen.getByText('流水记录-10')).toBeInTheDocument();
    expect(screen.queryByText('流水记录-9')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '积分流水下一页' }));
    expect(screen.getByText('流水记录-20')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '积分流水下一页' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '积分流水上一页' }));
    expect(screen.getByText('流水记录-10')).toBeInTheDocument();
  });
  it('keeps credit action columns shrinkable and preserves the full reversal label', async () => {
    render(<ServiceOperations />);
    await openCustomerTab('积分管理');

    for (const title of ['管理员充值', '余额调整', '冲正流水']) {
      expect(screen.getAllByText(title)[0].parentElement?.parentElement?.className).toBeTruthy();
    }

    const fullLabel = '充值 · 1,000,000 积分 · 首次充值';
    const selectedLabel = (await screen.findAllByTitle(fullLabel)).find(
      (element) => element.tagName === 'SPAN',
    );
    expect(selectedLabel).toBeDefined();
    expect(selectedLabel!).toHaveTextContent(fullLabel);
    expect(selectedLabel?.className).toBeTruthy();
  });
  it('keeps long account content in a keyboard-accessible scroll region', () => {
    render(<ServiceOperations />);
    const content = screen.getByRole('region', { name: '账户管理内容' });
    /* 网站式滚动（2026-09-17）：本节点不再自带 overflow:auto，纵向滚动由
       Settings/Layout 外壳承担；这里只断言区域可键盘聚焦。 */
    expect(content).not.toHaveStyle({ overflow: 'auto' });
    expect(content).toHaveAttribute('tabindex', '0');
    content.focus();
    expect(content).toHaveFocus();
  });
  it('opens customer details separately and returns to the searchable directory', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    expect(screen.queryByRole('tab', { name: '客户概览' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '已选择' }));
    expect(screen.getByRole('tab', { name: '客户概览' })).toBeInTheDocument();
    expect(screen.queryByLabelText('搜索用户')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回客户列表' }));
    expect(screen.getByLabelText('搜索用户')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '客户概览' })).not.toBeInTheDocument();
  });
  it('sends the former template workspace to in-group member management', async () => {
    window.history.replaceState({}, '', '/settings/service-operations?workspace=template');

    render(<ServiceOperations />);

    expect(await screen.findByText('成员配置已移至超级工作群')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /超级群/ })).toBeNull();
    expect(screen.queryByLabelText('搜索用户')).not.toBeInTheDocument();
  });

  it('opens platform moderation separately without stacking it below customer records', async () => {
    const first = render(<ServiceOperations />);
    expect(await screen.findByLabelText('搜索用户')).toBeInTheDocument();
    expect(screen.queryByLabelText('审计用户 ID')).not.toBeInTheDocument();
    expect(screen.queryByText('敏感信息审计')).not.toBeInTheDocument();
    first.unmount();

    window.history.replaceState({}, '', '/settings/content-moderation');
    render(<ServiceOperations />);
    expect(await screen.findByText('敏感信息审计')).toBeInTheDocument();
    expect(screen.queryByLabelText('搜索用户')).not.toBeInTheDocument();
  });

  it('separates customer data into focused views', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '已选择' }));

    expect(await screen.findByRole('tab', { name: '客户概览' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('账号资料与安全')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '私人群组目录' })).not.toBeInTheDocument();
    expect(screen.queryByText('登录会话安全概览')).not.toBeInTheDocument();
    expect(screen.queryByText('积分管理操作')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '群组与内容' }));
    expect(await screen.findByRole('region', { name: '私人群组目录' })).toBeInTheDocument();
    expect(screen.getByText('用户内容')).toBeInTheDocument();
    expect(screen.queryByText('账号资料与安全')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '安全与会话' }));
    expect(await screen.findByText('登录会话安全概览')).toBeInTheDocument();
    expect(screen.getByText('最近安全操作')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '私人群组目录' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '积分管理' }));
    expect(await screen.findByText('积分管理操作')).toBeInTheDocument();
    expect(screen.getByText('积分流水')).toBeInTheDocument();
    expect(screen.queryByText('登录会话安全概览')).not.toBeInTheDocument();
  });

  it('keeps every operations tab group inside its responsive layout contract', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);

    await user.click(await screen.findByRole('button', { name: '已选择' }));
    const detailTabs = screen.getByRole('tab', { name: '客户概览' }).closest('[role="tablist"]');
    expect(detailTabs?.className).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: '群组与内容' }));
    const contentTabs = screen.getByRole('tab', { name: '生成任务 3' }).closest('[role="tablist"]');
    expect(contentTabs?.className).toBeTruthy();
  });

  it('reveals the selected user details when the user button is pressed', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    render(<ServiceOperations />);
    await user.click(await screen.findByRole('button', { name: '已选择' }));

    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' }),
    );
  });

  it('loads the current user page through one batch summary query without per-user RPC calls', async () => {
    const secondUser = {
      ...userRow,
      email: 'li@example.com',
      fullName: '李四',
      id: 'customer-li',
      username: 'lisi',
    };
    mocks.listUsersQuery.mockReturnValue({
      data: { items: [userRow, secondUser], limit: 20, offset: 0, total: 2 },
      error: null,
      isLoading: false,
      refetch: mocks.usersRefetch,
    });
    mocks.getUserSummariesQuery.mockReturnValue({
      data: {
        items: [
          {
            balanceCredits: 1_000_000,
            generationTotal: 3,
            groupReadiness: 'ready',
            userId: userRow.id,
          },
          {
            balanceCredits: 25,
            generationTotal: 1,
            groupReadiness: 'missing',
            userId: secondUser.id,
          },
        ],
      },
      error: null,
      isLoading: false,
      refetch: mocks.userSummariesRefetch,
    });

    render(<ServiceOperations />);

    expect(mocks.getUserSummariesQuery).toHaveBeenCalledWith(
      { userIds: [userRow.id, secondUser.id] },
      expect.objectContaining({ enabled: true, retry: false }),
    );
    expect(mocks.getUserAccount).not.toHaveBeenCalled();
    expect(mocks.getUserOverview).not.toHaveBeenCalled();
    expect(await screen.findByText('李四')).toBeInTheDocument();
    expect(screen.getByText('25 积分')).toBeInTheDocument();
  });

  it('shows safe private-group summaries without requesting member details', async () => {
    render(<ServiceOperations />);
    await openCustomerTab('群组与内容');

    const region = await screen.findByRole('region', { name: '私人群组目录' });
    expect(within(region).getAllByText('旅游服务超级群组')).toHaveLength(2);
    expect(within(region).getByText('群组已就绪')).toBeInTheDocument();
    expect(within(region).queryByText('旅游文案助理')).not.toBeInTheDocument();
    expect(within(region).queryByText('已启用')).not.toBeInTheDocument();
    expect(within(region).queryByText('已停用')).not.toBeInTheDocument();
    expect(mocks.listUserPrivateGroupsQuery).toHaveBeenLastCalledWith(
      { limit: 10, targetUserId: userRow.id },
      expect.objectContaining({ enabled: true, retry: false }),
    );
    expect(mocks.getUserPrivateGroupMembersQuery).not.toHaveBeenCalled();
    expect(within(region).queryByText('旅游群主AI')).not.toBeInTheDocument();
    for (const forbidden of [
      'PRIVATE_GROUP_CONFIG_MUST_NOT_RENDER',
      'PRIVATE_GROUP_MODEL_MUST_NOT_RENDER',
      'PRIVATE_GROUP_PROVIDER_MUST_NOT_RENDER',
      'PRIVATE_GROUP_PROMPT_MUST_NOT_RENDER',
      'PRIVATE_MEMBER_CONFIG_MUST_NOT_RENDER',
      'PRIVATE_MEMBER_MODEL_MUST_NOT_RENDER',
      'PRIVATE_MEMBER_PROVIDER_MUST_NOT_RENDER',
      'PRIVATE_MEMBER_PROMPT_MUST_NOT_RENDER',
    ]) {
      expect(within(region).queryByText(forbidden)).not.toBeInTheDocument();
    }
    expect(
      within(region).queryByRole('button', { name: /删除|移除|改名|保存/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps group pagination bound to the selected user without loading members', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await openCustomerTab('群组与内容');

    const region = await screen.findByRole('region', { name: '私人群组目录' });
    await user.click(within(region).getByRole('button', { name: '群组下一页' }));
    await waitFor(() =>
      expect(mocks.listUserPrivateGroupsQuery).toHaveBeenLastCalledWith(
        {
          cursor: 'private-groups-next-cursor',
          limit: 10,
          targetUserId: userRow.id,
        },
        expect.objectContaining({ enabled: true, retry: false }),
      ),
    );
    expect(mocks.getUserPrivateGroupMembersQuery).not.toHaveBeenCalled();
  });

  it('shows a fixed group-directory error with a bounded retry', async () => {
    const user = userEvent.setup();
    mocks.listUserPrivateGroupsQuery.mockReturnValue({
      data: undefined,
      error: new Error('PRIVATE_GROUP_DATABASE_SECRET'),
      isLoading: false,
      refetch: mocks.privateGroupsRefetch,
    });
    const { rerender } = render(<ServiceOperations />);
    await openCustomerTab('群组与内容');

    let region = await screen.findByRole('region', { name: '私人群组目录' });
    expect(within(region).getByRole('alert')).toHaveTextContent('私人群组目录暂时无法读取');
    expect(within(region).queryByText('PRIVATE_GROUP_DATABASE_SECRET')).not.toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: '重试群组目录' }));
    expect(mocks.privateGroupsRefetch).toHaveBeenCalledTimes(1);

    mocks.listUserPrivateGroupsQuery.mockReturnValue({
      data: privateGroupCatalog,
      error: null,
      isLoading: false,
      refetch: mocks.privateGroupsRefetch,
    });
    rerender(<ServiceOperations />);

    region = await screen.findByRole('region', { name: '私人群组目录' });
    expect(within(region).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(region).getAllByText('旅游服务超级群组')).toHaveLength(2);
    expect(mocks.getUserPrivateGroupMembersQuery).not.toHaveBeenCalled();
  });

  it('shows a fixed user-list error and offers a bounded retry', async () => {
    const user = userEvent.setup();
    mocks.listUsersQuery.mockReturnValue({
      data: undefined,
      error: new Error('USER_LIST_DATABASE_SECRET'),
      isLoading: false,
      refetch: mocks.usersRefetch,
    });
    render(<ServiceOperations />);

    expect(await screen.findByText('用户列表暂时无法读取')).toBeInTheDocument();
    expect(screen.queryByText('USER_LIST_DATABASE_SECRET')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试用户列表' }));

    expect(mocks.usersRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows a read-only responsive private-group health and repair preview', async () => {
    render(<ServiceOperations />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '已选择' }));

    const region = await screen.findByRole('region', { name: '私人群健康与修复预案' });
    expect(within(region).getByText('状态：需检查')).toHaveAttribute('data-color', 'red');
    expect(within(region).getByRole('alert')).toHaveTextContent('需要人工审核');
    expect(within(region).getByText('DEFAULT_GROUP_DUPLICATED')).toHaveAttribute(
      'data-color',
      'red',
    );
    expect(within(region).getByText('SUPERVISOR_COUNT_INVALID')).toHaveAttribute(
      'data-color',
      'red',
    );
    expect(within(region).getByText('UNKNOWN_ISSUE_REVIEW_REQUIRED × 1')).toHaveAttribute(
      'data-color',
      'red',
    );
    const issueList = within(region).getByRole('list', { name: '群健康问题代码' });
    expect(issueList).toHaveStyle({ minWidth: 0 });
    expect(within(issueList).getAllByRole('listitem')).toHaveLength(17);
    expect(
      within(region).queryByRole('button', { name: /修复|删除|封禁/ }),
    ).not.toBeInTheDocument();
    for (const forbidden of [
      'GROUP_MEMBER_DETAILS_MUST_NOT_RENDER',
      'GROUP_MODEL_MUST_NOT_RENDER',
      'GROUP_PROMPT_MUST_NOT_RENDER',
      'GROUP_PROVIDER_KEY_MUST_NOT_RENDER',
      'GROUP_SYSTEM_ROLE_MUST_NOT_RENDER',
    ]) {
      expect(within(region).queryByText(forbidden)).not.toBeInTheDocument();
    }
    expect(mocks.getUserTravelGroupHealthOverviewQuery).toHaveBeenLastCalledWith(
      { targetUserId: userRow.id },
      expect.objectContaining({ enabled: true, retry: false }),
    );
  });

  it('shows a healthy private group without a manual-review warning', async () => {
    mocks.getUserTravelGroupHealthOverviewQuery.mockReturnValue({
      data: {
        actionCounts: [],
        canRepair: false,
        issueCodes: [],
        planFingerprint: 'a'.repeat(64),
        ready: true,
        reviewRequired: false,
      },
      error: null,
      isLoading: false,
      refetch: mocks.travelGroupHealthRefetch,
    });
    render(<ServiceOperations />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '已选择' }));

    const region = await screen.findByRole('region', { name: '私人群健康与修复预案' });
    expect(within(region).getByText('状态：健康')).toHaveAttribute('data-color', 'green');
    expect(within(region).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(region).getByText('无建议动作')).toBeInTheDocument();
  });

  it('does not mark the private group unhealthy before its health data loads', async () => {
    mocks.getUserTravelGroupHealthOverviewQuery.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
      refetch: mocks.travelGroupHealthRefetch,
    });
    render(<ServiceOperations />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '已选择' }));

    const region = await screen.findByRole('region', { name: '私人群健康与修复预案' });
    expect(within(region).getByText('状态：读取中')).not.toHaveAttribute('data-color', 'red');
    expect(within(region).queryByText('状态：需检查')).not.toBeInTheDocument();
  });

  it('repairs one safe target plan only after confirmation and stays contained on a narrow screen', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    window.dispatchEvent(new Event('resize'));
    const planFingerprint = 'b'.repeat(64);
    mocks.getUserTravelGroupHealthOverviewQuery.mockReturnValue({
      data: {
        actionCounts: [{ code: 'SET_PRIVATE', count: 1 }],
        canRepair: true,
        issueCodes: ['DEFAULT_GROUP_NOT_PRIVATE'],
        planFingerprint,
        ready: false,
        reviewRequired: false,
      },
      error: null,
      isLoading: false,
      refetch: mocks.travelGroupHealthRefetch,
    });
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '已选择' }));

    const region = await screen.findByRole('region', { name: '私人群健康与修复预案' });
    expect(region).toHaveStyle({ maxWidth: '100%', minWidth: 0 });
    expect(within(region).getByText('SET_PRIVATE × 1')).toBeInTheDocument();
    const openButton = within(region).getByRole('button', { name: '执行安全修复' });
    expect(mocks.repairUserTravelGroup).not.toHaveBeenCalled();

    await user.click(openButton);
    expect(mocks.repairUserTravelGroup).not.toHaveBeenCalled();
    const dialog = within(region).getByRole('alertdialog');
    expect(dialog).toHaveStyle({ maxWidth: '100%', minWidth: 0 });
    expect(within(dialog).getByText('确认修复该用户的私人旅游群？')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '确认执行安全修复' }));

    await waitFor(() =>
      expect(mocks.repairUserTravelGroup).toHaveBeenCalledWith({
        confirmed: true,
        planFingerprint,
        targetUserId: userRow.id,
      }),
    );
    expect(mocks.repairUserTravelGroup.mock.calls[0][0]).not.toHaveProperty('actions');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('私人旅游群已按安全预案修复');
    expect(mocks.travelGroupHealthRefetch).toHaveBeenCalled();
  });

  it('does not offer repair for a banned target even when a stale preview says it is executable', async () => {
    mocks.listUsersQuery.mockReturnValue({
      data: { items: [{ ...userRow, banned: true }], limit: 20, offset: 0, total: 1 },
      error: null,
      isLoading: false,
      refetch: mocks.usersRefetch,
    });
    mocks.getUserTravelGroupHealthOverviewQuery.mockReturnValue({
      data: {
        actionCounts: [{ code: 'SET_PRIVATE', count: 1 }],
        canRepair: true,
        issueCodes: ['DEFAULT_GROUP_NOT_PRIVATE'],
        planFingerprint: 'c'.repeat(64),
        ready: false,
        reviewRequired: false,
      },
      error: null,
      isLoading: false,
      refetch: mocks.travelGroupHealthRefetch,
    });
    render(<ServiceOperations />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '已选择' }));

    const region = await screen.findByRole('region', { name: '私人群健康与修复预案' });
    expect(within(region).getByRole('alert')).toHaveTextContent('目标用户已封禁');
    expect(within(region).queryByRole('button', { name: '执行安全修复' })).not.toBeInTheDocument();
  });

  it('shows a read-only target safety overview with bounded filters and keyset pagination', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');

    expect(await screen.findByText('敏感信息安全概览')).toBeInTheDocument();
    expect(screen.getByText('命中总数 1')).toBeInTheDocument();
    expect(screen.getByText('拦截 1')).toBeInTheDocument();
    expect(screen.getByText('待处理 1')).toBeInTheDocument();
    expect(
      screen.getByText('安全事件 ID：33333333-3333-4333-8333-333333333333'),
    ).toBeInTheDocument();
    expect(screen.queryByText('SAFETY_MESSAGE_MUST_NOT_RENDER')).not.toBeInTheDocument();
    expect(screen.queryByText('SAFETY_PROMPT_MUST_NOT_RENDER')).not.toBeInTheDocument();
    expect(screen.queryByText('SAFETY_PROVIDER_KEY_MUST_NOT_RENDER')).not.toBeInTheDocument();
    expect(screen.queryByText('SAFETY_TOKEN_MUST_NOT_RENDER')).not.toBeInTheDocument();
    expect(screen.queryByText('SAFETY_SOURCE_ID_MUST_NOT_RENDER')).not.toBeInTheDocument();
    const safetyRegion = screen.getByRole('region', { name: '敏感信息安全概览' });
    expect(
      within(safetyRegion).queryByRole('button', { name: /删除|封禁/ }),
    ).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('安全分类'), 'credential');
    await user.selectOptions(screen.getByLabelText('严重级别'), 'critical');
    await user.selectOptions(screen.getByLabelText('安全处置状态'), 'pending');
    await user.type(screen.getByLabelText('开始日期'), '2026-09-01');
    await user.type(screen.getByLabelText('结束日期'), '2026-09-03');
    await user.click(screen.getByRole('button', { name: '应用安全筛选' }));

    await waitFor(() =>
      expect(mocks.getUserSafetyOverviewQuery).toHaveBeenLastCalledWith(
        {
          category: 'credential',
          endAt: new Date('2026-09-03T23:59:59.999Z'),
          limit: 10,
          severity: 'critical',
          startAt: new Date('2026-09-01T00:00:00.000Z'),
          status: 'pending',
          targetUserId: userRow.id,
        },
        expect.objectContaining({ enabled: true, retry: false }),
      ),
    );

    await user.click(screen.getByRole('button', { name: '安全事件下一页' }));
    await waitFor(() =>
      expect(mocks.getUserSafetyOverviewQuery).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: 'opaque-safety-cursor', targetUserId: userRow.id }),
        expect.objectContaining({ enabled: true, retry: false }),
      ),
    );
  });

  it('shows only safe generated-content catalog summaries for the selected user', async () => {
    render(<ServiceOperations />);
    await openCustomerTab('群组与内容');

    expect(await screen.findByText('用户内容')).toBeInTheDocument();
    expect(screen.getByText('生成任务 3')).toBeInTheDocument();
    expect(screen.getByText('作品 1')).toBeInTheDocument();
    expect(screen.getByText('文档 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '作品 1' }));
    expect(screen.getByText('川藏线作品')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '文档 1' }));
    expect(screen.getByText('西藏行程摘要')).toBeInTheDocument();
    expect(screen.getByText(/文件名：西藏行程\.md/)).toBeInTheDocument();
    expect(screen.getByText(/当前仅提供目录信息/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除内容/ })).not.toBeInTheDocument();

    for (const kind of ['generation', 'work', 'document']) {
      expect(mocks.getUserContentCatalogQuery).toHaveBeenCalledWith(
        { kind, limit: 5, targetUserId: userRow.id },
        expect.objectContaining({ enabled: true, retry: false }),
      );
    }
    for (const forbidden of [
      'CONTENT_DOCUMENT_BODY_MUST_NOT_RENDER',
      'CONTENT_DOCUMENT_METADATA_MUST_NOT_RENDER',
      'CONTENT_INTERNAL_ERROR_MUST_NOT_RENDER',
      'CONTENT_PROMPT_MUST_NOT_RENDER',
      'CONTENT_PROVIDER_MUST_NOT_RENDER',
      'CONTENT_PROVIDER_KEY_MUST_NOT_RENDER',
      'CONTENT_WORK_BODY_MUST_NOT_RENDER',
      'CONTENT_WORK_URL_MUST_NOT_RENDER',
      '123456',
    ]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  it('keeps an empty content catalog compact without filters or pagination', async () => {
    mocks.getUserContentCatalogQuery.mockReturnValue({
      data: { counts: { generationTasks: 0, works: 0, documents: 0 }, items: [], nextCursor: null },
      error: null,
      isLoading: false,
      refetch: mocks.contentCatalogRefetch,
    });
    render(<ServiceOperations />);
    await openCustomerTab('群组与内容');
    expect(screen.getByText('该用户暂无生成任务')).toBeInTheDocument();
    expect(screen.queryByText('筛选生成任务')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /生成任务上一页|生成任务下一页/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '作品内容目录' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '文档 0' }));
    expect(screen.getByText('该用户暂无文档')).toBeInTheDocument();
  });

  it('applies independent type, status, and date filters to each content catalog', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await openCustomerTab('群组与内容');

    await screen.findByText('用户内容');
    await user.click(screen.getByText('筛选生成任务'));
    mocks.getUserContentCatalogQuery.mockClear();

    await user.type(screen.getByLabelText('生成任务类型'), 'copy');
    await user.type(screen.getByLabelText('生成任务状态'), 'succeeded');
    await user.type(screen.getByLabelText('生成任务开始日期'), '2026-09-01');
    await user.type(screen.getByLabelText('生成任务结束日期'), '2026-09-03');
    await user.click(screen.getByRole('button', { name: '应用生成任务筛选' }));

    await waitFor(() =>
      expect(mocks.getUserContentCatalogQuery).toHaveBeenCalledWith(
        {
          endAt: new Date('2026-09-03T23:59:59.999Z'),
          kind: 'generation',
          limit: 5,
          startAt: new Date('2026-09-01T00:00:00.000Z'),
          status: 'succeeded',
          targetUserId: userRow.id,
          type: 'copy',
        },
        expect.objectContaining({ enabled: true, retry: false }),
      ),
    );
    expect(mocks.getUserContentCatalogQuery).toHaveBeenCalledWith(
      { kind: 'work', limit: 5, targetUserId: userRow.id },
      expect.objectContaining({ enabled: true, retry: false }),
    );
    expect(mocks.getUserContentCatalogQuery).toHaveBeenCalledWith(
      { kind: 'document', limit: 5, targetUserId: userRow.id },
      expect.objectContaining({ enabled: true, retry: false }),
    );

    await user.click(screen.getByRole('tab', { name: '作品 1' }));
    await user.click(screen.getByText('筛选作品'));
    await user.type(screen.getByLabelText('作品类型'), 'document');
    await user.type(screen.getByLabelText('作品状态'), 'completed');
    await user.type(screen.getByLabelText('作品开始日期'), '2026-08-01');
    await user.type(screen.getByLabelText('作品结束日期'), '2026-08-31');
    await user.click(screen.getByRole('button', { name: '应用作品筛选' }));
    await user.click(screen.getByRole('tab', { name: '文档 1' }));
    await user.click(screen.getByText('筛选文档'));
    await user.type(screen.getByLabelText('文档类型'), 'text/markdown');
    await user.type(screen.getByLabelText('文档开始日期'), '2026-07-01');
    await user.type(screen.getByLabelText('文档结束日期'), '2026-07-31');
    await user.click(screen.getByRole('button', { name: '应用文档筛选' }));

    await waitFor(() => {
      expect(mocks.getUserContentCatalogQuery).toHaveBeenCalledWith(
        {
          endAt: new Date('2026-08-31T23:59:59.999Z'),
          kind: 'work',
          limit: 5,
          startAt: new Date('2026-08-01T00:00:00.000Z'),
          status: 'completed',
          targetUserId: userRow.id,
          type: 'document',
        },
        expect.objectContaining({ enabled: true, retry: false }),
      );
      expect(mocks.getUserContentCatalogQuery).toHaveBeenCalledWith(
        {
          endAt: new Date('2026-07-31T23:59:59.999Z'),
          kind: 'document',
          limit: 5,
          startAt: new Date('2026-07-01T00:00:00.000Z'),
          targetUserId: userRow.id,
          type: 'text/markdown',
        },
        expect.objectContaining({ enabled: true, retry: false }),
      );
    });
  });

  it('moves independently through content catalog cursors in both directions', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await openCustomerTab('群组与内容');

    await screen.findByText('用户内容');
    mocks.getUserContentCatalogQuery.mockClear();
    await user.click(screen.getByRole('button', { name: '生成任务下一页' }));

    await waitFor(() =>
      expect(mocks.getUserContentCatalogQuery).toHaveBeenCalledWith(
        {
          cursor: 'opaque-generation-cursor',
          kind: 'generation',
          limit: 5,
          targetUserId: userRow.id,
        },
        expect.objectContaining({ enabled: true, retry: false }),
      ),
    );

    mocks.getUserContentCatalogQuery.mockClear();
    await user.click(screen.getByRole('button', { name: '生成任务上一页' }));
    await waitFor(() =>
      expect(mocks.getUserContentCatalogQuery).toHaveBeenCalledWith(
        { kind: 'generation', limit: 5, targetUserId: userRow.id },
        expect.objectContaining({ enabled: true, retry: false }),
      ),
    );
  });

  it('resets content catalog cursors when switching users', async () => {
    const user = userEvent.setup();
    const anotherUser = {
      ...userRow,
      email: 'li@example.com',
      fullName: '李四',
      id: 'customer-li',
      username: 'lisi',
    };
    mocks.listUsersQuery.mockReturnValue({
      data: { items: [userRow, anotherUser], limit: 20, offset: 0, total: 2 },
      error: null,
      isLoading: false,
      refetch: mocks.usersRefetch,
    });
    render(<ServiceOperations />);
    await openCustomerTab('群组与内容');

    await screen.findByText('用户内容');
    await user.click(screen.getByRole('button', { name: '生成任务下一页' }));
    await waitFor(() =>
      expect(mocks.getUserContentCatalogQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: 'opaque-generation-cursor',
          kind: 'generation',
          targetUserId: userRow.id,
        }),
        expect.anything(),
      ),
    );

    mocks.getUserContentCatalogQuery.mockClear();
    await user.click(screen.getByRole('button', { name: '返回客户列表' }));
    await user.click(screen.getByRole('button', { name: '查看' }));
    await waitFor(() =>
      expect(mocks.getUserContentCatalogQuery).toHaveBeenCalledWith(
        { kind: 'generation', limit: 5, targetUserId: anotherUser.id },
        expect.objectContaining({ enabled: true, retry: false }),
      ),
    );
    expect(mocks.getUserContentCatalogQuery).not.toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: 'opaque-generation-cursor',
        kind: 'generation',
        targetUserId: anotherUser.id,
      }),
      expect.anything(),
    );
  });

  it('shows a fixed content-summary error without exposing backend details', async () => {
    mocks.getUserContentCatalogQuery.mockReturnValue({
      data: undefined,
      error: new Error('CONTENT_BACKEND_PROVIDER_KEY_MUST_NOT_RENDER'),
      isLoading: false,
      refetch: mocks.contentCatalogRefetch,
    });
    render(<ServiceOperations />);
    await openCustomerTab('群组与内容');

    expect(await screen.findAllByText(/内容摘要暂时无法读取$/)).toHaveLength(1);
    expect(screen.queryByText(/CONTENT_BACKEND_PROVIDER_KEY/)).not.toBeInTheDocument();
  });

  it('keeps successful content catalogs visible when one catalog fails and retries only that section', async () => {
    const user = userEvent.setup();
    mocks.getUserContentCatalogQuery.mockImplementation(
      (input: { kind: keyof typeof contentCatalogs }) => ({
        data: input.kind === 'document' ? undefined : contentCatalogs[input.kind],
        error: input.kind === 'document' ? new Error('DOCUMENT_INTERNAL_SECRET') : null,
        isLoading: false,
        refetch: mocks.contentCatalogRefetch,
      }),
    );
    render(<ServiceOperations />);
    await openCustomerTab('群组与内容');

    expect(screen.getByText('content-generation-safe-id')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '作品 1' }));
    expect(await screen.findByText('川藏线作品')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '文档 1' }));
    expect(screen.getByText('文档内容摘要暂时无法读取')).toBeInTheDocument();
    expect(screen.queryByText('DOCUMENT_INTERNAL_SECRET')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重试文档内容摘要' }));
    expect(mocks.contentCatalogRefetch).toHaveBeenCalledTimes(1);
  });

  it('collapses a confirmed empty safety overview without filters or pagination', async () => {
    mocks.getUserSafetyOverviewQuery.mockReturnValue({
      data: {
        items: [],
        summary: { total: 0, block: 0, review: 0, pending: 0, reviewed: 0 },
        nextCursor: null,
      },
      error: null,
      isLoading: false,
    });
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');
    const region = screen.getByRole('region', { name: '敏感信息安全概览' });
    expect(within(region).getByText('暂无安全事件')).toBeInTheDocument();
    expect(within(region).queryByText('命中总数 0')).not.toBeInTheDocument();
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
    expect(within(region).queryByLabelText('安全分类')).not.toBeInTheDocument();
  });

  it('keeps safety filters available after a filter returns no events', async () => {
    mocks.getUserSafetyOverviewQuery.mockImplementation((input: { category?: string }) => ({
      data: input.category
        ? { ...userSafetyOverview, items: [], summary: { ...userSafetyOverview.summary, total: 0 } }
        : userSafetyOverview,
      error: null,
      isLoading: false,
    }));
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');
    const region = screen.getByRole('region', { name: '敏感信息安全概览' });
    await userEvent.selectOptions(within(region).getByLabelText('安全分类'), 'credential');
    await userEvent.click(within(region).getByRole('button', { name: '应用安全筛选' }));
    expect(within(region).getByText('暂无匹配的安全事件')).toBeInTheDocument();
    expect(within(region).getByLabelText('安全分类')).toBeInTheDocument();
    expect(within(region).queryByText('暂无安全事件')).not.toBeInTheDocument();
  });

  it('shows only the selected user session count and safe administrator session fields', async () => {
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');

    expect(await screen.findByText('登录会话安全概览')).toBeInTheDocument();
    expect(screen.getByText('会话总数：3')).toBeInTheDocument();
    expect(screen.getByText(/IP：198\.51\.100\.88/)).toBeInTheDocument();
    expect(screen.getByText(/User-Agent：Safari 19 \/ macOS/)).toBeInTheDocument();
    expect(screen.getByText(/仅显示最近 10 条/)).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.getUserSessionOverviewQuery).toHaveBeenLastCalledWith(
        { limit: 10, targetUserId: userRow.id },
        expect.objectContaining({ enabled: true, retry: false }),
      ),
    );

    for (const forbidden of [
      'SESSION_COOKIE_MUST_NOT_RENDER',
      'SESSION_EMAIL_BODY_MUST_NOT_RENDER',
      'SESSION_PASSWORD_MUST_NOT_RENDER',
      'SESSION_PROVIDER_KEY_MUST_NOT_RENDER',
      'SESSION_TOKEN_MUST_NOT_RENDER',
    ]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  it('revokes the selected user sessions only after explicit confirmation', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');
    await screen.findByText('登录会话安全概览');

    await user.click(screen.getByRole('button', { name: '撤销该用户全部会话' }));
    expect(mocks.revokeUserSessions).not.toHaveBeenCalled();
    expect(
      screen.getByRole('alertdialog', { name: '确认撤销该用户全部会话？' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认撤销全部会话' }));

    await waitFor(() =>
      expect(mocks.revokeUserSessions).toHaveBeenCalledWith({ targetUserId: userRow.id }),
    );
    expect(mocks.sessionOverviewRefetch).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('该用户的全部会话已撤销');
  });

  it('discards a pending session-revocation confirmation when switching users', async () => {
    const user = userEvent.setup();
    const anotherUser = {
      ...userRow,
      email: 'li@example.com',
      fullName: '李四',
      id: 'customer-li',
      username: 'lisi',
    };
    mocks.listUsersQuery.mockReturnValue({
      data: { items: [userRow, anotherUser], limit: 20, offset: 0, total: 2 },
      error: null,
      isLoading: false,
      refetch: mocks.usersRefetch,
    });
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');

    await user.click(await screen.findByRole('button', { name: '撤销该用户全部会话' }));
    expect(screen.getByRole('button', { name: '确认撤销全部会话' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回客户列表' }));
    await user.click(screen.getByRole('button', { name: '查看' }));
    expect(screen.queryByRole('button', { name: '确认撤销全部会话' })).not.toBeInTheDocument();
    expect(mocks.revokeUserSessions).not.toHaveBeenCalled();
  });

  it('shows a fixed session error and never offers self-revocation in the administrator panel', async () => {
    mocks.currentUserId.mockReturnValue(userRow.id);
    mocks.getUserSessionOverviewQuery.mockReturnValue({
      data: undefined,
      error: new Error('SESSION_QUERY_TOKEN_MUST_NOT_LEAK'),
      isLoading: false,
      refetch: mocks.sessionOverviewRefetch,
    });
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');

    expect(await screen.findByText('登录会话暂时无法读取')).toBeInTheDocument();
    expect(screen.getByText('当前管理员请在个人中心管理自己的会话')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销该用户全部会话' })).not.toBeInTheDocument();
    expect(screen.queryByText(/SESSION_QUERY_TOKEN/)).not.toBeInTheDocument();
  });

  it('shows only recent safe administrator audit fields for the selected user', async () => {
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');

    expect(await screen.findByText('最近安全操作')).toBeInTheDocument();
    expect(screen.getByText('资料已修改')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
    expect(screen.getByText(/操作管理员：platform-admin-operator/)).toBeInTheDocument();
    expect(screen.getByText(/目标用户：customer-zhang/)).toBeInTheDocument();
    expect(screen.queryByText(/操作 ID/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.listAuditEventsQuery).toHaveBeenLastCalledWith(
        { limit: 10, targetUserId: userRow.id },
        expect.objectContaining({ enabled: true, retry: false }),
      ),
    );

    for (const forbidden of [
      'AUDIT_EMAIL_BODY_MUST_NOT_RENDER',
      '203.0.113.99',
      'AUDIT_METADATA_MUST_NOT_RENDER',
      'AUDIT_PASSWORD_MUST_NOT_RENDER',
      'AUDIT_TOKEN_MUST_NOT_RENDER',
      'platform-operation-safe-id',
    ]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  it('shows customer operations with 积分 and CNY travel ledgers in explicit partitions', async () => {
    render(<ServiceOperations />);

    expect(await screen.findByText('张三')).toBeInTheDocument();
    expect(screen.getByText('zhang@example.com')).toBeInTheDocument();
    expect(screen.getByText(/198\.51\.100\.24/)).toBeInTheDocument();
    expect(screen.getAllByText('群组已就绪')).not.toHaveLength(0);
    expect(screen.getByText('生成 3 项')).toBeInTheDocument();
    expect(screen.getByText('1,000,000 积分')).toBeInTheDocument();
    expect(screen.queryByText('旅行服务账本（CNY）')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '人民币服务账本' })).not.toBeInTheDocument();
    expect(screen.queryByText('internal-model-name')).not.toBeInTheDocument();
    expect(screen.queryByText('internal-provider-name')).not.toBeInTheDocument();
    expect(screen.queryByText('generation-sensitive-id')).not.toBeInTheDocument();
  });

  it('clears target-bound 积分 operation drafts when switching users', async () => {
    const user = userEvent.setup();
    const anotherUser = {
      ...userRow,
      email: 'li@example.com',
      fullName: '李四',
      id: 'customer-li',
      username: 'lisi',
    };
    mocks.listUsersQuery.mockReturnValue({
      data: { items: [userRow, anotherUser], limit: 20, offset: 0, total: 2 },
      error: null,
      isLoading: false,
      refetch: mocks.usersRefetch,
    });
    render(<ServiceOperations />);
    await openCustomerTab('积分管理');

    await user.type(await screen.findByLabelText('充值积分'), '1000000');
    await user.type(screen.getByLabelText('调整积分'), '-500');

    await user.click(screen.getByRole('button', { name: '返回客户列表' }));
    await user.click(screen.getByRole('button', { name: '查看' }));

    await openCustomerTab('积分管理');
    expect(screen.getByLabelText('充值积分')).toHaveValue('');
    expect(screen.getByLabelText('调整积分')).toHaveValue('');
  });

  it('sets a new password only after confirmation and toggles its visibility', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await user.click(await screen.findByRole('button', { name: '已选择' }));
    const input = screen.getByLabelText('新密码');
    await user.type(input, 'New-password-12345');
    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: '查看新密码' }));
    expect(input).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    expect(mocks.setUserPassword).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认修改密码' }));
    expect(mocks.setUserPassword).toHaveBeenCalledWith({
      targetUserId: 'customer-zhang',
      password: 'New-password-12345',
    });
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it.each([
    [
      '删除未完成：账号已停用，但登录会话清理失败。请重试；不继续删除可恢复用户。',
      '删除未完成：账号已停用，但登录会话清理失败。请重试；不继续删除可恢复用户。',
    ],
    ['private database details', '删除请求失败，暂无法确认账号状态。请刷新用户资料后重试。'],
  ])('shows safe deletion failures without a fabricated wait: %s', async (message, expected) => {
    mocks.deleteUser.mockRejectedValueOnce(new Error(message));
    const onDeleted = vi.fn();
    render(<ManagedDeleteControl userId="customer-zhang" userLabel="张三" onDeleted={onDeleted} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '删除用户' }));
    await user.click(screen.getByRole('button', { name: '确认永久删除' }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(/等待运行中的任务/)).not.toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('confirms deletion by clicking without requiring a user ID and returns to the list', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await user.click(await screen.findByRole('button', { name: '已选择' }));
    await user.click(screen.getByRole('button', { name: '删除用户' }));
    expect(screen.queryByLabelText('确认删除的用户 ID')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认永久删除' })).toBeEnabled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认永久删除' }));
    expect(mocks.deleteUser).toHaveBeenCalledWith({
      targetUserId: 'customer-zhang',
      confirmed: true,
    });
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog', { name: '永久删除用户' })).not.toBeInTheDocument(),
    );
  });

  it('suspends a user through the existing login and AI ban after confirmation', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');
    await user.click(screen.getByRole('button', { name: '暂停用户' }));
    expect(mocks.banUser).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认暂停用户' }));
    expect(mocks.banUser).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId: 'customer-zhang',
        reason: expect.stringContaining('暂停用户'),
      }),
    );
  });

  it('updates a target display name/avatar only after explicit session-revocation confirmation', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '已选择' }));
    await screen.findByText('张三');

    expect(screen.getByText('账号资料与安全')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /新密码|当前密码/ })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('用户显示名称'));
    await user.type(screen.getByLabelText('用户显示名称'), '张三·更新');
    await user.type(screen.getByLabelText('用户头像 URL'), 'https://example.com/new-avatar.png');
    await user.click(screen.getByRole('button', { name: '保存用户资料' }));

    expect(mocks.updateUserProfile).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: '确认修改该用户资料？' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认保存并退出该用户设备' }));

    await waitFor(() =>
      expect(mocks.updateUserProfile).toHaveBeenCalledWith({
        avatar: 'https://example.com/new-avatar.png',
        fullName: '张三·更新',
        targetUserId: userRow.id,
      }),
    );
    expect(mocks.usersRefetch).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('用户资料已更新，该用户需重新登录');
  });

  it('forces the official one-time password reset without accepting or exposing a password', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '已选择' }));
    await screen.findByText('张三');

    await user.click(screen.getByRole('button', { name: '强制密码重置' }));
    expect(mocks.forceUserPasswordReset).not.toHaveBeenCalled();
    expect(
      screen.getByRole('alertdialog', { name: '确认强制该用户重置密码？' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /密码/ })).not.toBeInTheDocument();
    expect(screen.getByText(/旅游群网一次性重置链接/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '发送重置链接并退出该用户设备' }));

    await waitFor(() =>
      expect(mocks.forceUserPasswordReset).toHaveBeenCalledWith({ targetUserId: userRow.id }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith('密码重置邮件已发送，该用户已退出全部设备');
  });

  it('never offers target-account profile/password actions for the current administrator', async () => {
    mocks.currentUserId.mockReturnValue(userRow.id);
    render(<ServiceOperations />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '已选择' }));

    expect(
      await screen.findByText('当前管理员请在个人中心修改自己的资料和密码'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存用户资料' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '强制密码重置' })).not.toBeInTheDocument();
  });

  it('shows a fixed account error without exposing backend password or mail details', async () => {
    const user = userEvent.setup();
    mocks.forceUserPasswordReset.mockRejectedValueOnce(
      new Error('SMTP_PASSWORD_AND_RESET_TOKEN_MUST_NOT_LEAK'),
    );
    render(<ServiceOperations />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '已选择' }));
    await screen.findByText('张三');

    await user.click(screen.getByRole('button', { name: '强制密码重置' }));
    await user.click(screen.getByRole('button', { name: '发送重置链接并退出该用户设备' }));

    expect(await screen.findByText('密码重置未安全完成，请重试')).toBeInTheDocument();
    expect(screen.queryByText(/SMTP_PASSWORD|RESET_TOKEN/)).not.toBeInTheDocument();
  });

  it('labels an incomplete private group as waiting to be completed', async () => {
    const incompleteOverview = {
      ...overview,
      travelGroup: { ...overview.travelGroup, readiness: 'incomplete' },
    };
    mocks.getUserOverview.mockResolvedValue(incompleteOverview);
    mocks.getUserOverviewQuery.mockReturnValue({
      data: incompleteOverview,
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<ServiceOperations />);
    await openCustomerTab('群组与内容');

    expect(await screen.findByText('群组待补齐')).toBeInTheDocument();
  });

  it('rejects fractional 积分 before calling an administrator mutation', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await openCustomerTab('积分管理');
    await screen.findByText('张三');

    await user.type(screen.getByLabelText('充值积分'), '12.5');
    await user.click(screen.getByRole('button', { name: '确认充值' }));

    expect(await screen.findByText('积分必须为安全范围内的整数')).toBeInTheDocument();
    expect(mocks.topUp).not.toHaveBeenCalled();
  });

  it('shows unresolved provider calls without unsafe manual settlement actions', async () => {
    render(<ServiceOperations />);
    await openCustomerTab('积分管理');

    expect(await screen.findByText('待对账调用')).toBeInTheDocument();
    expect(screen.getByText('服务商结果未知')).toBeInTheDocument();
    expect(screen.getByText('deepseek / deepseek-chat')).toBeInTheDocument();
    expect(screen.getByText('未捕获服务商请求 ID')).toBeInTheDocument();
    expect(screen.getByText('2,961,629 积分预留')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '释放预留' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '人工扣费' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试调用' })).not.toBeInTheDocument();
    expect(mocks.listPendingReservationsQuery).toHaveBeenCalledWith(
      { limit: 100, targetUserId: userRow.id },
      { enabled: true, retry: false },
    );
  });

  it('requires reasons for credit top-ups and reversals while retaining idempotency', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await openCustomerTab('积分管理');
    await screen.findByText('张三');

    await user.type(screen.getByLabelText('充值积分'), '1000000');
    await user.click(screen.getByRole('button', { name: '确认充值' }));

    expect(mocks.topUp).not.toHaveBeenCalled();
    expect(await screen.findByText('请填写操作理由')).toBeInTheDocument();
    await user.type(screen.getByLabelText('充值理由'), '管理员充值');
    await user.click(screen.getByRole('button', { name: '确认充值' }));

    await waitFor(() =>
      expect(mocks.topUp).toHaveBeenCalledWith({
        credits: 1_000_000,
        idempotencyKey: expect.stringMatching(/^admin-ui:top-up:/),
        reason: '管理员充值',
        targetUserId: 'customer-zhang',
      }),
    );

    await user.click(screen.getByRole('button', { name: '确认冲正' }));

    expect(mocks.reverse).not.toHaveBeenCalled();
    expect(await screen.findByText('请填写操作理由')).toBeInTheDocument();
    await user.type(screen.getByLabelText('冲正理由'), '管理员冲正流水');
    await user.click(screen.getByRole('button', { name: '确认冲正' }));

    await waitFor(() =>
      expect(mocks.reverse).toHaveBeenCalledWith({
        entryId: creditEntry.id,
        idempotencyKey: expect.stringMatching(/^admin-ui:reversal:/),
        reason: '管理员冲正流水',
      }),
    );
  });

  it('submits a signed integer 积分 adjustment with an idempotency key', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await openCustomerTab('积分管理');
    await screen.findByText('张三');

    await user.type(screen.getByLabelText('调整积分'), '-250');
    await user.click(screen.getByRole('button', { name: '确认调整' }));

    expect(mocks.adjust).not.toHaveBeenCalled();
    expect(await screen.findByText('请填写操作理由')).toBeInTheDocument();
    await user.type(screen.getByLabelText('调整理由'), '管理员余额调整');
    await user.click(screen.getByRole('button', { name: '确认调整' }));

    await waitFor(() =>
      expect(mocks.adjust).toHaveBeenCalledWith({
        credits: -250,
        idempotencyKey: expect.stringMatching(/^admin-ui:adjust:/),
        reason: '管理员余额调整',
        targetUserId: 'customer-zhang',
      }),
    );
  });

  it('lists moderation summaries and only loads the redacted preview after opening details', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/settings/content-moderation');
    render(<ServiceOperations />);

    expect(await screen.findAllByText('文案生成')).not.toHaveLength(0);
    expect(screen.getAllByText('拦截')).not.toHaveLength(0);
    expect(screen.getAllByText(/凭证或密钥/)).not.toHaveLength(0);
    expect(screen.getAllByText('待处理')).not.toHaveLength(0);
    expect(screen.getAllByText(/检测时间：/)).not.toHaveLength(0);
    expect(screen.queryByText('[CREDENTIAL]')).not.toBeInTheDocument();
    expect(screen.queryByText('a'.repeat(64))).not.toBeInTheDocument();
    expect(screen.queryByText('source-opaque-id')).not.toBeInTheDocument();
    expect(mocks.getModerationRecordQuery).toHaveBeenCalledWith(
      { id: '' },
      expect.objectContaining({ enabled: false }),
    );

    await user.click(screen.getByRole('button', { name: '查看审计详情' }));

    expect(await screen.findByText('[CREDENTIAL]')).toBeInTheDocument();
    expect(screen.queryByText('a'.repeat(64))).not.toBeInTheDocument();
    expect(screen.queryByText('source-opaque-id')).not.toBeInTheDocument();
    expect(mocks.getModerationRecordQuery).toHaveBeenLastCalledWith(
      { id: moderationRecord.id },
      expect.objectContaining({ enabled: true }),
    );
  });

  it('applies the minimal moderation filters and paginates from offset zero', async () => {
    const user = userEvent.setup();
    mocks.listModerationRecordsQuery.mockReturnValue({
      data: { items: [moderationRecord], limit: 20, offset: 0, total: 21 },
      error: null,
      isLoading: false,
      refetch: mocks.moderationListRefetch,
    });
    window.history.replaceState({}, '', '/settings/content-moderation');
    render(<ServiceOperations />);

    await user.type(screen.getByLabelText('审计用户 ID'), ' customer-zhang ');
    await user.selectOptions(screen.getByLabelText('处置状态'), 'pending');
    await user.selectOptions(screen.getByLabelText('检测结论'), 'block');
    await user.click(screen.getByRole('button', { name: '应用审计筛选' }));

    await waitFor(() =>
      expect(mocks.listModerationRecordsQuery).toHaveBeenLastCalledWith(
        {
          disposition: 'pending',
          limit: 20,
          offset: 0,
          userId: 'customer-zhang',
          verdict: 'block',
        },
        expect.objectContaining({ retry: false }),
      ),
    );

    await user.click(screen.getByRole('button', { name: '审计下一页' }));
    await waitFor(() =>
      expect(mocks.listModerationRecordsQuery).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 20, userId: 'customer-zhang' }),
        expect.objectContaining({ retry: false }),
      ),
    );
  });

  it('marks moderation records reviewed, cleared, or recommended for banning without claiming a ban', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/settings/content-moderation');
    render(<ServiceOperations />);
    await user.click(await screen.findByRole('button', { name: '查看审计详情' }));

    expect(
      await screen.findByText('封禁建议只记录处置建议，不会直接封禁用户。'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '标记已复核' }));
    await user.click(screen.getByRole('button', { name: '解除记录' }));
    await user.click(screen.getByRole('button', { name: '提出封禁建议' }));

    await waitFor(() => {
      expect(mocks.markModerationReviewed).toHaveBeenCalledWith({ id: moderationRecord.id });
      expect(mocks.clearModeration).toHaveBeenCalledWith({ id: moderationRecord.id });
      expect(mocks.recommendModerationBan).toHaveBeenCalledWith({ id: moderationRecord.id });
      expect(mocks.moderationListRefetch).toHaveBeenCalled();
      expect(mocks.moderationDetailRefetch).toHaveBeenCalled();
    });
  });

  it('allows only one moderation disposition while a request is in flight', async () => {
    const user = userEvent.setup();
    const pendingReview = createDeferred<typeof moderationDetail>();
    mocks.markModerationReviewed.mockReturnValueOnce(pendingReview.promise);
    window.history.replaceState({}, '', '/settings/content-moderation');
    render(<ServiceOperations />);
    await user.click(await screen.findByRole('button', { name: '查看审计详情' }));

    await user.click(screen.getByRole('button', { name: '标记已复核' }));
    expect(screen.getByRole('button', { name: '解除记录' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '提出封禁建议' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '解除记录' }));
    await user.click(screen.getByRole('button', { name: '提出封禁建议' }));

    expect(mocks.markModerationReviewed).toHaveBeenCalledTimes(1);
    expect(mocks.clearModeration).not.toHaveBeenCalled();
    expect(mocks.recommendModerationBan).not.toHaveBeenCalled();

    pendingReview.resolve(moderationDetail);
    await waitFor(() => expect(mocks.moderationListRefetch).toHaveBeenCalled());
  });

  it('shows a generic moderation error without exposing a backend message', async () => {
    const user = userEvent.setup();
    mocks.markModerationReviewed.mockRejectedValueOnce(new Error('SQL_SECRET_INTERNAL'));
    window.history.replaceState({}, '', '/settings/content-moderation');
    render(<ServiceOperations />);
    await user.click(await screen.findByRole('button', { name: '查看审计详情' }));
    await user.click(screen.getByRole('button', { name: '标记已复核' }));

    expect(await screen.findByText('处置失败，请重试')).toBeInTheDocument();
    expect(screen.queryByText('SQL_SECRET_INTERNAL')).not.toBeInTheDocument();
  });

  it('does not offer a self-ban action for the current administrator', async () => {
    mocks.currentUserId.mockReturnValue(userRow.id);
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');

    expect(await screen.findByText('不能封禁当前管理员账号')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '封禁用户' })).not.toBeInTheDocument();
  });

  it('requires explicit confirmation, a non-sensitive reason, and accepts an optional future expiry', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');
    await user.click(await screen.findByRole('button', { name: '封禁用户' }));
    expect(mocks.banUser).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '确认封禁用户' }));
    expect(await screen.findByText('请填写封禁理由')).toBeInTheDocument();

    await user.type(screen.getByLabelText('封禁理由'), 'contact@example.com');
    await user.click(screen.getByRole('button', { name: '确认封禁用户' }));
    expect(await screen.findByText('封禁理由不得包含密钥或联系方式等敏感信息')).toBeInTheDocument();
    expect(mocks.banUser).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('封禁理由'));
    await user.type(screen.getByLabelText('封禁理由'), '多次违反使用规则');
    expect(screen.getByText(/按当前设备本地时区/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('封禁到期时间'), '2099-01-01T00:00');
    await user.click(screen.getByRole('button', { name: '确认封禁用户' }));

    await waitFor(() =>
      expect(mocks.banUser).toHaveBeenCalledWith({
        banExpires: new Date('2099-01-01T00:00'),
        reason: '多次违反使用规则',
        targetUserId: userRow.id,
      }),
    );
    const submittedExpiry = mocks.banUser.mock.calls[0][0].banExpires as Date;
    expect(submittedExpiry.getTime()).toBe(new Date(2099, 0, 1, 0, 0).getTime());
    expect(mocks.usersRefetch).toHaveBeenCalled();
    expect(mocks.userAccountRefetch).toHaveBeenCalled();
    expect(mocks.userEntriesRefetch).toHaveBeenCalled();
    expect(mocks.userOverviewRefetch).toHaveBeenCalled();
  });

  it('strictly rejects a past local ban expiry', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');
    await user.click(await screen.findByRole('button', { name: '封禁用户' }));
    await user.type(screen.getByLabelText('封禁理由'), '多次违反使用规则');
    await user.type(screen.getByLabelText('封禁到期时间'), '2000-01-01T00:00');
    await user.click(screen.getByRole('button', { name: '确认封禁用户' }));

    expect(await screen.findByText('封禁到期时间必须是有效的未来本地时间')).toBeInTheDocument();
    expect(mocks.banUser).not.toHaveBeenCalled();
  });

  it('submits a ban only once while the request remains in flight', async () => {
    const user = userEvent.setup();
    const pendingBan = createDeferred<{
      banExpires: null;
      banned: boolean;
      banReason: string;
      id: string;
    }>();
    mocks.banUser.mockReturnValueOnce(pendingBan.promise);
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');
    await user.click(await screen.findByRole('button', { name: '封禁用户' }));
    await user.type(screen.getByLabelText('封禁理由'), '多次违反使用规则');

    const confirmButton = screen.getByRole('button', { name: '确认封禁用户' });
    await user.click(confirmButton);
    expect(confirmButton).toBeDisabled();
    await user.click(confirmButton);
    expect(mocks.banUser).toHaveBeenCalledTimes(1);

    pendingBan.resolve({
      banExpires: null,
      banned: true,
      banReason: '多次违反使用规则',
      id: userRow.id,
    });
    await waitFor(() => expect(mocks.usersRefetch).toHaveBeenCalled());
  });

  it('requires explicit confirmation before unbanning a user', async () => {
    const user = userEvent.setup();
    const bannedUser = {
      ...userRow,
      banExpires: new Date('2099-01-01T00:00:00.000Z'),
      banned: true,
      banReason: '多次违反使用规则',
    };
    mocks.listUsersQuery.mockReturnValue({
      data: { items: [bannedUser], limit: 20, offset: 0, total: 1 },
      error: null,
      isLoading: false,
      refetch: mocks.usersRefetch,
    });
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');

    await user.click(await screen.findByRole('button', { name: '恢复用户 / 解除封禁' }));
    expect(mocks.unbanUser).not.toHaveBeenCalled();
    expect(screen.getByText('确认解除该用户的封禁状态？')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认解除封禁' }));

    await waitFor(() => expect(mocks.unbanUser).toHaveBeenCalledWith({ targetUserId: userRow.id }));
    expect(mocks.usersRefetch).toHaveBeenCalled();
  });

  it('submits an unban only once while the request remains in flight', async () => {
    const user = userEvent.setup();
    const bannedUser = {
      ...userRow,
      banExpires: new Date('2099-01-01T00:00:00.000Z'),
      banned: true,
      banReason: '多次违反使用规则',
    };
    const pendingUnban = createDeferred<{
      banExpires: null;
      banned: boolean;
      banReason: null;
      id: string;
    }>();
    mocks.listUsersQuery.mockReturnValue({
      data: { items: [bannedUser], limit: 20, offset: 0, total: 1 },
      error: null,
      isLoading: false,
      refetch: mocks.usersRefetch,
    });
    mocks.unbanUser.mockReturnValueOnce(pendingUnban.promise);
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');
    await user.click(await screen.findByRole('button', { name: '恢复用户 / 解除封禁' }));

    const confirmButton = screen.getByRole('button', { name: '确认解除封禁' });
    await user.click(confirmButton);
    expect(confirmButton).toBeDisabled();
    await user.click(confirmButton);
    expect(mocks.unbanUser).toHaveBeenCalledTimes(1);

    pendingUnban.resolve({ banExpires: null, banned: false, banReason: null, id: userRow.id });
    await waitFor(() => expect(mocks.usersRefetch).toHaveBeenCalled());
  });

  it('keeps a successful ban successful and invalidates summaries when one refresh fails', async () => {
    const user = userEvent.setup();
    mocks.userEntriesRefetch.mockRejectedValueOnce(new Error('temporary refresh failure'));
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');
    expect(mocks.getUserAccount).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: '封禁用户' }));
    await user.type(screen.getByLabelText('封禁理由'), '多次违反使用规则');
    await user.click(screen.getByRole('button', { name: '确认封禁用户' }));

    await waitFor(() => expect(mocks.userSummariesRefetch).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('用户已封禁');
    expect(mocks.toastError).toHaveBeenCalledWith('操作已成功，但用户摘要刷新失败，请手动刷新页面');
    expect(screen.queryByText('封禁失败，请重试')).not.toBeInTheDocument();
  });

  it('renders confirmations as accessible alert dialogs', async () => {
    const user = userEvent.setup();
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');
    await user.click(await screen.findByRole('button', { name: '封禁用户' }));

    const dialog = screen.getByRole('alertdialog', { name: '确认封禁该用户？' });
    expect(dialog).toHaveAttribute('aria-describedby');
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
  });

  it('redacts and truncates an existing server ban reason before display', async () => {
    const sensitiveReason = `联系 contact@example.com 处理 ${'过长理由'.repeat(30)}`;
    mocks.listUsersQuery.mockReturnValue({
      data: {
        items: [{ ...userRow, banned: true, banReason: sensitiveReason }],
        limit: 20,
        offset: 0,
        total: 1,
      },
      error: null,
      isLoading: false,
      refetch: mocks.usersRefetch,
    });
    render(<ServiceOperations />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '已选择' }));

    await userEvent.setup().click(screen.getByRole('button', { name: '返回客户列表' }));
    expect(await screen.findByText(/封禁原因：联系 \[已隐藏邮箱\].*…/)).toBeInTheDocument();
    expect(screen.queryByText(/contact@example\.com/)).not.toBeInTheDocument();
  });

  it('shows a generic ban error without exposing backend details', async () => {
    const user = userEvent.setup();
    mocks.banUser.mockRejectedValueOnce(new Error('DATABASE_SECRET_INTERNAL'));
    render(<ServiceOperations />);
    await openCustomerTab('安全与会话');
    await user.click(await screen.findByRole('button', { name: '封禁用户' }));
    await user.type(screen.getByLabelText('封禁理由'), '多次违反使用规则');
    await user.click(screen.getByRole('button', { name: '确认封禁用户' }));

    expect(await screen.findByText('封禁失败，请重试')).toBeInTheDocument();
    expect(screen.queryByText('DATABASE_SECRET_INTERNAL')).not.toBeInTheDocument();
  });
});
