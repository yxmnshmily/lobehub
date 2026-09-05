import { describe, expect, it } from 'vitest';

import {
  buildDefaultTravelServiceGroupRepairPlan,
  type DefaultTravelServiceGroupHealthIssueCode,
  type DefaultTravelServiceGroupHealthSummary,
} from './travelServiceGroup';

const healthySummary: DefaultTravelServiceGroupHealthSummary = {
  groupCount: 1,
  healthy: true,
  isPrivate: true,
  issueCodes: [],
  requiredMembers: {
    'copywriter': { enabled: true, exists: true, platformManaged: true },
    'designer': { enabled: true, exists: true, platformManaged: true },
    'document-assistant': { enabled: true, exists: true, platformManaged: true },
    'video-producer': { enabled: true, exists: true, platformManaged: true },
  },
  supervisor: { count: 1, platformManaged: true, titleMatches: true },
};

const summaryWithIssue = (
  issueCode: DefaultTravelServiceGroupHealthIssueCode,
): DefaultTravelServiceGroupHealthSummary => ({
  ...healthySummary,
  healthy: false,
  issueCodes: [issueCode],
  supervisor: { ...healthySummary.supervisor },
});

describe('buildDefaultTravelServiceGroupRepairPlan', () => {
  it.each([
    ['DEFAULT_GROUP_MISSING', { code: 'CREATE_DEFAULT_GROUP', target: 'group' }],
    ['DEFAULT_GROUP_DUPLICATED', { code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED', target: 'group' }],
    ['DEFAULT_GROUP_NOT_PRIVATE', { code: 'SET_PRIVATE', target: 'group' }],
    ['DEFAULT_GROUP_INSTRUCTIONS_MISSING', { code: 'ENSURE_GROUP_INSTRUCTIONS', target: 'group' }],
    ['DEFAULT_GROUP_SCOPE_INVALID', { code: 'UNKNOWN_ISSUE_REVIEW_REQUIRED', target: 'group' }],
    ['SUPERVISOR_COUNT_INVALID', { code: 'ENSURE_SUPERVISOR', target: 'supervisor' }],
    ['LEGACY_INBOX_SUPERVISOR', { code: 'MIGRATE_LEGACY_INBOX_SUPERVISOR', target: 'supervisor' }],
    ['SUPERVISOR_IDENTITY_INVALID', { code: 'SUPERVISOR_REVIEW_REQUIRED', target: 'supervisor' }],
    ['SUPERVISOR_DISABLED', { code: 'ENSURE_SUPERVISOR', target: 'supervisor' }],
    ['SUPERVISOR_TITLE_INVALID', { code: 'RENAME_SUPERVISOR', target: 'supervisor' }],
    ['SUPERVISOR_NOT_PLATFORM_MANAGED', { code: 'MARK_PLATFORM_MANAGED', target: 'supervisor' }],
    ['COPYWRITER_MISSING', { code: 'ENSURE_REQUIRED_MEMBER', target: 'copywriter' }],
    ['COPYWRITER_DISABLED', { code: 'ENABLE_REQUIRED_MEMBER', target: 'copywriter' }],
    ['COPYWRITER_NOT_PLATFORM_MANAGED', { code: 'MARK_PLATFORM_MANAGED', target: 'copywriter' }],
    ['COPYWRITER_SKILL_BINDING_MISSING', { code: 'ENSURE_REQUIRED_MEMBER', target: 'copywriter' }],
    ['COPYWRITER_TOOL_BINDING_MISSING', { code: 'ENSURE_REQUIRED_MEMBER', target: 'copywriter' }],
    ['COPYWRITER_DUPLICATED', { code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED', target: 'copywriter' }],
    ['DESIGNER_MISSING', { code: 'ENSURE_REQUIRED_MEMBER', target: 'designer' }],
    ['DESIGNER_DISABLED', { code: 'ENABLE_REQUIRED_MEMBER', target: 'designer' }],
    ['DESIGNER_NOT_PLATFORM_MANAGED', { code: 'MARK_PLATFORM_MANAGED', target: 'designer' }],
    ['DESIGNER_SKILL_BINDING_MISSING', { code: 'ENSURE_REQUIRED_MEMBER', target: 'designer' }],
    ['DESIGNER_TOOL_BINDING_MISSING', { code: 'ENSURE_REQUIRED_MEMBER', target: 'designer' }],
    ['DESIGNER_DUPLICATED', { code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED', target: 'designer' }],
    ['VIDEO_PRODUCER_MISSING', { code: 'ENSURE_REQUIRED_MEMBER', target: 'video-producer' }],
    ['VIDEO_PRODUCER_DISABLED', { code: 'ENABLE_REQUIRED_MEMBER', target: 'video-producer' }],
    [
      'VIDEO_PRODUCER_NOT_PLATFORM_MANAGED',
      { code: 'MARK_PLATFORM_MANAGED', target: 'video-producer' },
    ],
    [
      'VIDEO_PRODUCER_SKILL_BINDING_MISSING',
      { code: 'ENSURE_REQUIRED_MEMBER', target: 'video-producer' },
    ],
    [
      'VIDEO_PRODUCER_TOOL_BINDING_MISSING',
      { code: 'ENSURE_REQUIRED_MEMBER', target: 'video-producer' },
    ],
    [
      'VIDEO_PRODUCER_DUPLICATED',
      { code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED', target: 'video-producer' },
    ],
    [
      'DOCUMENT_ASSISTANT_MISSING',
      { code: 'ENSURE_REQUIRED_MEMBER', target: 'document-assistant' },
    ],
    [
      'DOCUMENT_ASSISTANT_DISABLED',
      { code: 'ENABLE_REQUIRED_MEMBER', target: 'document-assistant' },
    ],
    [
      'DOCUMENT_ASSISTANT_NOT_PLATFORM_MANAGED',
      { code: 'MARK_PLATFORM_MANAGED', target: 'document-assistant' },
    ],
    [
      'DOCUMENT_ASSISTANT_SKILL_BINDING_MISSING',
      { code: 'ENSURE_REQUIRED_MEMBER', target: 'document-assistant' },
    ],
    [
      'DOCUMENT_ASSISTANT_TOOL_BINDING_MISSING',
      { code: 'ENSURE_REQUIRED_MEMBER', target: 'document-assistant' },
    ],
    [
      'DOCUMENT_ASSISTANT_DUPLICATED',
      { code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED', target: 'document-assistant' },
    ],
  ] as const)('maps %s to its fixed preview action', (issueCode, expectedAction) => {
    const summary = summaryWithIssue(issueCode);
    if (issueCode === 'SUPERVISOR_COUNT_INVALID') summary.supervisor.count = 0;

    const reviewRequired = [
      'DEFAULT_GROUP_DUPLICATED',
      'DEFAULT_GROUP_SCOPE_INVALID',
      'SUPERVISOR_IDENTITY_INVALID',
      'COPYWRITER_DUPLICATED',
      'DESIGNER_DUPLICATED',
      'VIDEO_PRODUCER_DUPLICATED',
      'DOCUMENT_ASSISTANT_DUPLICATED',
    ].includes(issueCode);
    expect(buildDefaultTravelServiceGroupRepairPlan(summary)).toEqual({
      actions: [
        {
          ...expectedAction,
          reviewRequired,
        },
      ],
      reviewRequired,
    });
  });

  it('returns the same empty plan every time for a healthy summary', () => {
    expect(buildDefaultTravelServiceGroupRepairPlan(healthySummary)).toEqual({
      actions: [],
      reviewRequired: false,
    });
    expect(buildDefaultTravelServiceGroupRepairPlan(healthySummary)).toEqual({
      actions: [],
      reviewRequired: false,
    });
  });

  it('uses fixed issue order instead of trusting input order', () => {
    const summary: DefaultTravelServiceGroupHealthSummary = {
      ...healthySummary,
      healthy: false,
      issueCodes: ['COPYWRITER_DISABLED', 'SUPERVISOR_TITLE_INVALID', 'DEFAULT_GROUP_NOT_PRIVATE'],
    };

    expect(buildDefaultTravelServiceGroupRepairPlan(summary).actions).toEqual([
      { code: 'SET_PRIVATE', reviewRequired: false, target: 'group' },
      { code: 'RENAME_SUPERVISOR', reviewRequired: false, target: 'supervisor' },
      { code: 'ENABLE_REQUIRED_MEMBER', reviewRequired: false, target: 'copywriter' },
    ]);
  });

  it('collapses multiple binding issues for one member into one safe repair action', () => {
    const summary: DefaultTravelServiceGroupHealthSummary = {
      ...healthySummary,
      healthy: false,
      issueCodes: ['COPYWRITER_TOOL_BINDING_MISSING', 'COPYWRITER_SKILL_BINDING_MISSING'],
    };

    expect(buildDefaultTravelServiceGroupRepairPlan(summary)).toEqual({
      actions: [{ code: 'ENSURE_REQUIRED_MEMBER', reviewRequired: false, target: 'copywriter' }],
      reviewRequired: false,
    });
  });

  it('requires review instead of previewing an automatic supervisor removal', () => {
    const summary = summaryWithIssue('SUPERVISOR_COUNT_INVALID');
    summary.supervisor.count = 2;

    expect(buildDefaultTravelServiceGroupRepairPlan(summary)).toEqual({
      actions: [
        {
          code: 'SUPERVISOR_REVIEW_REQUIRED',
          reviewRequired: true,
          target: 'supervisor',
        },
      ],
      reviewRequired: true,
    });
  });

  it('fails closed on an unknown issue code without previewing known automatic actions', () => {
    const summary = {
      ...healthySummary,
      healthy: false,
      issueCodes: ['DEFAULT_GROUP_NOT_PRIVATE', 'FUTURE_UNKNOWN_ISSUE'],
    } as unknown as DefaultTravelServiceGroupHealthSummary;

    expect(buildDefaultTravelServiceGroupRepairPlan(summary)).toEqual({
      actions: [{ code: 'UNKNOWN_ISSUE_REVIEW_REQUIRED', reviewRequired: true, target: 'unknown' }],
      reviewRequired: true,
    });
  });
});
