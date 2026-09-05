import { createHash } from 'node:crypto';

export type PlatformModerationAction = 'allow' | 'block' | 'review';

export type PlatformModerationCategory =
  'credential' | 'email' | 'government_id' | 'phone' | 'provider_moderation';

export type PlatformModerationSeverity = 'critical' | 'high' | 'medium';

export interface PlatformModerationFinding {
  category: PlatformModerationCategory;
  count: number;
  severity: PlatformModerationSeverity;
}

export interface PlatformModerationProviderSignal {
  code: string;
  source: string;
}

export interface PlatformModerationScanInput {
  providerModeration?: PlatformModerationProviderSignal;
  text: string;
}

export interface PlatformModerationScanResult {
  action: PlatformModerationAction;
  findings: PlatformModerationFinding[];
  fingerprint: string;
  preview: string;
  providerSignal?: PlatformModerationProviderSignal;
}

interface DetectionRule {
  category: Exclude<PlatformModerationCategory, 'provider_moderation'>;
  patterns: RegExp[];
  replacement: string;
  severity: PlatformModerationSeverity;
}

const DETECTION_RULES: DetectionRule[] = [
  {
    category: 'credential',
    patterns: [
      /(?:api[_ -]?key|access[_ -]?token|password|secret|authorization)\s*[:=]\s*["']?[\w.~+/=-]{6,}["']?/gi,
      /\bBearer\s+[\w.~+/=-]{12,}/gi,
      /\b(?:sk|rk|pk)-[\w-]{16,}\b/gi,
    ],
    replacement: '[CREDENTIAL]',
    severity: 'critical',
  },
  {
    category: 'email',
    patterns: [/\b[\w.%+-]+@[a-z\d.-]+\.[a-z]{2,}\b/gi],
    replacement: '[EMAIL]',
    severity: 'medium',
  },
  {
    category: 'phone',
    patterns: [/(?<!\d)1[3-9]\d{9}(?!\d)/g],
    replacement: '[PHONE]',
    severity: 'medium',
  },
  {
    category: 'government_id',
    patterns: [/(?<!\d)\d{17}[\dX](?!\d)/gi],
    replacement: '[GOVERNMENT_ID]',
    severity: 'high',
  },
];

const sanitizeProviderSignal = (
  signal: PlatformModerationProviderSignal,
): PlatformModerationProviderSignal => ({
  code: signal.code.trim().slice(0, 80),
  source: signal.source.trim().slice(0, 80),
});

export const scanPlatformContent = ({
  providerModeration,
  text,
}: PlatformModerationScanInput): PlatformModerationScanResult => {
  const findings: PlatformModerationFinding[] = [];
  let preview = text;

  for (const rule of DETECTION_RULES) {
    let count = 0;

    for (const pattern of rule.patterns) {
      preview = preview.replace(pattern, () => {
        count += 1;
        return rule.replacement;
      });
    }

    if (count > 0) {
      findings.push({ category: rule.category, count, severity: rule.severity });
    }
  }

  const providerSignal = providerModeration
    ? sanitizeProviderSignal(providerModeration)
    : undefined;

  if (providerSignal) {
    findings.push({ category: 'provider_moderation', count: 1, severity: 'high' });
  }

  const shouldBlock = findings.some(
    ({ category }) => category === 'credential' || category === 'provider_moderation',
  );

  return {
    action: shouldBlock ? 'block' : findings.length > 0 ? 'review' : 'allow',
    findings,
    fingerprint: createHash('sha256').update(text).digest('hex'),
    preview: preview.slice(0, 240),
    ...(providerSignal ? { providerSignal } : {}),
  };
};
