// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const listTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [absolutePath] : [];
  });

const orchestrationSourcePath = path.resolve(__dirname, 'index.ts');
const serverSourceRoot = path.resolve(__dirname, '../..');

describe('travel orchestration dependency boundary', () => {
  it('keeps every generic AgentRuntime source free of travel business rules', () => {
    const runtimeRoots = [
      path.resolve(__dirname, '../../modules/AgentRuntime'),
      path.resolve(__dirname, '../../../../../packages/agent-runtime/src'),
    ];
    const forbiddenBusinessTokens = [
      'services/travelOrchestration',
      'default-travel-copywriter',
      'default-travel-image-designer',
      'default-travel-video-producer',
      'default-travel-document-assistant',
      'lobe-travel-production',
      'TRAVEL_SPECIALIST',
      '旅游群主AI',
    ];

    for (const runtimeRoot of runtimeRoots) {
      const productionFiles = listTypeScriptFiles(runtimeRoot).filter(
        (filename) =>
          !filename.endsWith('.test.ts') && !filename.includes(`${path.sep}__tests__${path.sep}`),
      );
      for (const filename of productionFiles) {
        const source = readFileSync(filename, 'utf8');
        for (const token of forbiddenBusinessTokens) expect(source).not.toContain(token);
      }
    }
  });

  it('allows only neutral policy types and the controlled production contract as dependencies', () => {
    const source = readFileSync(orchestrationSourcePath, 'utf8');
    const dependencies = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1]);

    expect(dependencies).toEqual(['@lobechat/builtin-tool-travel-production', '@lobechat/types']);
    for (const forbiddenDependency of [
      '@/app',
      '@/database',
      'website',
      'better-auth',
      'platformUsageBilling',
      'drizzle-orm',
      '@aws-sdk',
      'openai',
      'anthropic',
      'react',
      'antd',
    ]) {
      expect(dependencies.join('\n')).not.toContain(forbiddenDependency);
    }
  });

  it('does not log or report user content from the orchestration boundary', () => {
    const source = readFileSync(orchestrationSourcePath, 'utf8');
    const forbiddenLoggingPatterns = [
      /console\./,
      /from ['"]debug['"]/,
      /from ['"][^'"]*(?:logger|logging|telemetry)[^'"]*['"]/i,
      /(?:logger|log)\.(?:debug|info|warn|error)\(/,
      /captureException\(/,
      /captureMessage\(/,
      /Sentry\./,
    ];

    for (const pattern of forbiddenLoggingPatterns) expect(source).not.toMatch(pattern);
    expect(source).not.toMatch(/(?:console|logger|log)[^\n]*(?:input\.message|message)/);
  });

  it('keeps the public surface limited to orchestration input, result, error, and policy helpers', () => {
    const source = readFileSync(orchestrationSourcePath, 'utf8');
    const exportedNames = [
      ...source.matchAll(/^export (?:type|interface|const|function|class) (\w+)/gm),
    ].map((match) => match[1]);

    expect(exportedNames).toEqual([
      'TravelProductionIntent',
      'TravelOrchestrationMember',
      'TravelOrchestrationInput',
      'TRAVEL_SPECIALIST_UNAVAILABLE',
      'TravelRoutingResult',
      'routeTravelRequest',
      'TravelToolDispatchResult',
      'createTravelToolDispatchPolicy',
    ]);
  });

  it('exposes only controlled production consumers through the module entrypoint without leaking routing rules', () => {
    const productionFiles = listTypeScriptFiles(serverSourceRoot).filter(
      (filename) =>
        !filename.startsWith(__dirname) &&
        !filename.endsWith('.test.ts') &&
        !filename.includes(`${path.sep}__tests__${path.sep}`),
    );
    const consumers = productionFiles.filter((filename) =>
      readFileSync(filename, 'utf8').includes('services/travelOrchestration'),
    );

    expect(consumers.map((filename) => path.relative(serverSourceRoot, filename))).toEqual([
      'services/websiteAi/index.ts',
      'services/websiteAi/previousTurn.ts',
    ]);

    const runtimeConsumerSource = readFileSync(consumers[0], 'utf8');
    expect(runtimeConsumerSource).toContain(
      "import { createTravelToolDispatchPolicy } from '@/server/services/travelOrchestration';",
    );
    for (const leakedRule of [
      'default-travel-copywriter',
      'default-travel-image-designer',
      'default-travel-video-producer',
      'default-travel-document-assistant',
      'INTENT_RULES',
      'normalizeRoutingMessage',
    ]) {
      for (const consumer of consumers) {
        expect(readFileSync(consumer, 'utf8')).not.toContain(leakedRule);
      }
    }
  });
});
