import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const/agentDocument';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';
import type { AgentDocumentEditorSnapshot } from '@/server/services/agentDocuments/headlessEditor';

import {
  createTravelDocumentPage,
  normalizeTravelDocumentTitle,
  repairLegacyTravelDocuments,
} from './travelDocument';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  createMarkdownEditorSnapshot: vi.fn(),
  update: vi.fn(),
}));

type HeadlessEditorModule = {
  createMarkdownEditorSnapshot: (content: string) => Promise<AgentDocumentEditorSnapshot>;
};

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({ create: mocks.create, update: mocks.update })),
}));
vi.mock('@/server/services/agentDocuments/headlessEditor', () => ({
  createMarkdownEditorSnapshot: mocks.createMarkdownEditorSnapshot,
}));

describe('travel document page contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: 'document-1' });
    mocks.createMarkdownEditorSnapshot.mockResolvedValue({
      content: '# 桂林行程\n\n第一天。',
      editorData: { root: { children: [{ type: 'heading' }], type: 'root' } },
    });
  });

  it('creates a private editable Page with a safe display title', async () => {
    await createTravelDocumentPage({
      content: '# 桂林行程\n\n第一天。',
      db: {} as any,
      title: '../桂林安全行程...',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(mocks.create).toHaveBeenCalledWith({
      content: '# 桂林行程\n\n第一天。',
      editorData: { root: { children: [{ type: 'heading' }], type: 'root' } },
      fileType: CUSTOM_DOCUMENT_FILE_TYPE,
      filename: '桂林安全行程',
      source: 'travel-generation',
      sourceType: 'api',
      title: '桂林安全行程',
      totalCharCount: 12,
      totalLineCount: 3,
      visibility: 'private',
    });
    expect(DocumentModel).toHaveBeenCalledWith({}, 'user-1', 'workspace-1');
  });

  it('round-trips structured Chinese Markdown near 4000 characters through the real editor', async () => {
    const { createMarkdownEditorSnapshot } = await vi.importActual<HeadlessEditorModule>(
      '@/server/services/agentDocuments/headlessEditor',
    );
    mocks.createMarkdownEditorSnapshot.mockImplementationOnce(createMarkdownEditorSnapshot);
    const prefix = [
      '# 川藏线 8 日行程 🏔️',
      '',
      '| 日期 | 行程 | 住宿 |',
      '| --- | --- | --- |',
      '| D1 | 成都→康定 | 康定 |',
      '| D2 | 康定→理塘 | 理塘 |',
      '',
      '- 准备身份证',
      '- 带上防晒霆100+',
      '',
      '1. 早起看日照金山',
      '2. 晚上整理照片 📷',
      '',
      '',
    ].join('\n');
    const content = `${prefix}${'川藏线沿途风景如画，请注意高原反应。\n'.repeat(220)}`.slice(
      0,
      3980,
    );

    await createTravelDocumentPage({
      content,
      db: {} as any,
      title: '川藏线行程',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const persisted = mocks.create.mock.calls[0][0];
    expect(persisted.content.length).toBeGreaterThan(3800);
    expect(persisted.content).toContain('川藏线 8 日行程 🏔️');
    expect(persisted.content).toMatch(/\|\s*日期\s*\|\s*行程\s*\|\s*住宿\s*\|/);
    expect(persisted.content).toContain('- 准备身份证');
    expect(persisted.content).toContain('1. 早起看日照金山');
    expect(persisted.content).toContain('📷');
    expect(persisted.totalCharCount).toBe(persisted.content.length);
    expect(persisted.totalLineCount).toBe(persisted.content.split('\n').length);
    expect(isValidEditorData(persisted.editorData)).toBe(true);
  });

  it('stores model-returned HTML and script as editor text in a private document', async () => {
    const { createMarkdownEditorSnapshot } = await vi.importActual<HeadlessEditorModule>(
      '@/server/services/agentDocuments/headlessEditor',
    );
    mocks.createMarkdownEditorSnapshot.mockImplementationOnce(createMarkdownEditorSnapshot);
    const content = [
      '# 安全文档',
      '',
      '<script>globalThis.travelOwned = true</script>',
      '<img src=x onerror="alert(1)">',
    ].join('\n');

    await createTravelDocumentPage({
      content,
      db: {} as any,
      title: '安全文档',
      userId: 'user-1',
    });

    const persisted = mocks.create.mock.calls[0][0];
    const serializedEditor = JSON.stringify(persisted.editorData);
    expect(persisted).toMatchObject({
      fileType: CUSTOM_DOCUMENT_FILE_TYPE,
      source: 'travel-generation',
      sourceType: 'api',
      visibility: 'private',
    });
    expect(persisted.content).toContain('<script>globalThis.travelOwned = true</script>');
    expect(serializedEditor).toContain('<script>globalThis.travelOwned = true</script>');
    expect(serializedEditor).not.toMatch(/"type":"(?:html|script)"/);
  });

  it('normalizes path-like titles into a readable label', () => {
    expect(normalizeTravelDocumentTitle('../桂林安全行程...')).toBe('桂林安全行程');
    expect(normalizeTravelDocumentTitle('../../')).toBe('旅游文档');
  });

  it.each([
    ['control characters', '\u0000\u001F西藏\u007F\u0085行程'],
    ['slashes and dots', '../..\\西藏/行程...'],
    ['whitespace', ' \t\n西藏\u00A0行程\r '],
    ['only unsafe punctuation', '...///\\\u0000'],
    ['overlong title', '长'.repeat(200)],
  ])('normalizes %s into a bounded non-path title', (_label, rawTitle) => {
    const normalized = normalizeTravelDocumentTitle(rawTitle);

    expect(normalized.length).toBeGreaterThan(0);
    expect(normalized.length).toBeLessThanOrEqual(120);
    expect(
      [...normalized].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return (
          character === '/' ||
          character === '\\' ||
          codePoint < 32 ||
          (codePoint >= 127 && codePoint <= 159)
        );
      }),
    ).toBe(false);
    expect(normalized).not.toMatch(/^\.|\.$/);
    expect(normalized.trim()).toBe(normalized);
  });

  it('repairs only the exact users legacy travel-generation markdown rows', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        content: '# 旧行程',
        fileType: 'markdown',
        filename: '___桂林安全行程___.md',
        id: 'legacy-travel-document',
        source: 'travel-generation',
        title: '../桂林安全行程...',
        userId: 'user-1',
        workspaceId: null,
      },
      {
        content: '# 用户文件',
        fileType: 'markdown',
        id: 'ordinary-markdown',
        source: 'document',
        title: '用户文档',
        userId: 'user-1',
        workspaceId: null,
      },
      {
        content: '# 其他用户',
        fileType: 'markdown',
        id: 'other-user-travel-document',
        source: 'travel-generation',
        title: '其他用户文档',
        userId: 'user-2',
        workspaceId: null,
      },
    ]);
    mocks.createMarkdownEditorSnapshot.mockResolvedValue({
      content: '# 旧行程',
      editorData: { root: { children: [{ type: 'heading' }], type: 'root' } },
    });

    const result = await repairLegacyTravelDocuments(
      { query: { documents: { findMany } } } as any,
      'user-1',
    );

    expect(result).toEqual({ repaired: 1 });
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith(
      'legacy-travel-document',
      expect.objectContaining({
        editorData: { root: { children: [{ type: 'heading' }], type: 'root' } },
        fileType: CUSTOM_DOCUMENT_FILE_TYPE,
        filename: '桂林安全行程',
        sourceType: 'api',
        title: '桂林安全行程',
      }),
    );
  });
});
