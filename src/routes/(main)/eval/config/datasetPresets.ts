import type { LucideIcon } from 'lucide-react';
import { Database, Globe } from 'lucide-react';

export type PresetCategory = 'qa' | 'research' | 'tool-use' | 'memory' | 'reference' | 'custom';

export interface DatasetPreset {
  category: PresetCategory;
  description: string;
  // Example file
  exampleFileUrl?: string;
  // Auto-infer configuration
  fieldInference: {
    input: string[];
    expected: string[];
    choices: string[];
    category: string[];
    sortOrder?: string[];
  };
  // Format description
  formatDescription: string;

  icon: LucideIcon;
  id: string;
  name: string;

  optionalFields: string[];

  requiredFields: string[];

  // Validation rules
  validation?: {
    requireExpected?: boolean;
    requireChoices?: boolean;
    expectedFormat?: 'string' | 'string[]' | 'index';
  };
}

export const DATASET_PRESETS: Record<string, DatasetPreset> = {
  'browsecomp': {
    id: 'browsecomp',
    category: 'research',
    name: 'BrowseComp',
    description: '评估智能体浏览网页的能力，包含 1,266 道问题。',
    icon: Globe,
    formatDescription: '格式： Topic （分类/标签）, Question （输入）, Answer （预期答案）',
    requiredFields: ['question', 'answer', 'problem_topic', 'canary'],
    optionalFields: ['case_id'],
    fieldInference: {
      input: ['question'],
      expected: ['answer'],
      choices: [],
      category: ['problem_topic'],
    },
    validation: {
      requireExpected: true,
      expectedFormat: 'string',
    },
  },
  // === Deep Research / QA Category ===
  'browsecomp-zh': {
    id: 'browsecomp-zh',
    category: 'research',
    name: 'BrowseComp-ZH',
    description: '中文网页浏览评测：289 道多步骤推理问题。',
    icon: Globe,
    formatDescription: '格式： Topic （分类/标签）, Question （输入）, Answer （预期答案）',
    requiredFields: ['Question', 'Answer'],
    optionalFields: ['Topic', 'canary', 'case_id'],
    fieldInference: {
      input: ['Question', 'question', 'prompt'],
      expected: ['Answer', 'answer'],
      choices: [],
      category: ['Topic', 'topic', 'category'],
    },
    validation: {
      requireExpected: true,
      expectedFormat: 'string',
    },
  },

  'widesearch': {
    id: 'widesearch',
    category: 'research',
    name: 'WideSearch',
    description: '评估智能体广泛收集信息的能力，包含 200 道问题。',
    icon: Globe,
    formatDescription: '格式： instance_id, query （输入）, evaluation （预期答案）, language',
    requiredFields: ['instance_id', 'query', 'evaluation', 'language'],
    optionalFields: ['case_id'],
    fieldInference: {
      input: ['query'],
      expected: ['evaluation'],
      choices: [],
      category: ['language'],
      sortOrder: [],
    },
    validation: {
      requireExpected: true,
      expectedFormat: 'string',
    },
  },

  'hle-text': {
    id: 'hle-text',
    category: 'research',
    name: '人类终极考试 HLE（纯文本）',
    description: '人类终极考试（HLE）是覆盖人类知识前沿的多模态评测，包含 2,150 道问题。',
    icon: Globe,
    formatDescription:
      '格式： id, question （输入）, answer （预期答案）, answer_type, rationale, raw_subject, category',
    requiredFields: [
      'id',
      'question',
      'answer',
      'answer_type',
      'rationale',
      'raw_subject',
      'category',
    ],
    optionalFields: ['canary', 'case_id'],
    fieldInference: {
      input: ['question'],
      expected: ['answer'],
      choices: [],
      category: ['category'],
    },
  },

  'hle-verified': {
    id: 'hle-verified',
    category: 'research',
    name: '人类终极考试 HLE（已核验答案）',
    description:
      '人类终极考试（HLE）的已核验答案子集，用于评估生成正确答案而非仅看似合理答案的能力。',
    icon: Globe,
    formatDescription:
      '格式： id, question （输入）, answer （预期答案）, answer_type, rationale, raw_subject, category, Verified_Classes',
    requiredFields: [
      'id',
      'question',
      'answer',
      'answer_type',
      'rationale',
      'raw_subject',
      'category',
      'Verified_Classes',
    ],
    optionalFields: ['canary', 'case_id'],
    fieldInference: {
      input: ['question'],
      expected: ['answer'],
      choices: [],
      category: ['category'],
    },
  },

  'deepsearchqa': {
    id: 'deepsearchqa',
    category: 'research',
    name: 'DeepSearchQA',
    description:
      'Google DeepMind 的事实准确性评测，包含 900 道题目，覆盖 17 个领域的复杂多步骤信息检索任务。',
    icon: Globe,
    formatDescription: 'problem, problem_category, answer, answer_type',
    requiredFields: ['problem', 'answer', 'problem_category', 'answer_type'],
    optionalFields: ['case_id'],
    fieldInference: {
      input: ['problem'],
      expected: ['answer'],
      choices: [],
      category: ['problem_category'],
      sortOrder: [],
    },
    validation: {
      requireExpected: true,
      expectedFormat: 'string',
    },
  },

  'sealqa': {
    id: 'sealqa',
    category: 'research',
    name: 'SealQA',
    description:
      'SealQA 用于评估搜索增强语言模型在搜索结果相互冲突、噪声较多或缺少有效信息时回答事实问题的能力。',
    icon: Globe,
    formatDescription: '格式： question （输入）, answer （预期答案）, topic （分类）',
    requiredFields: ['question', 'answer', 'topic', 'canary'],
    optionalFields: ['case_id'],
    fieldInference: {
      input: ['question'],
      expected: ['answer'],
      choices: [],
      category: ['topic'],
    },
    validation: {
      requireExpected: true,
      expectedFormat: 'string',
    },
  },

  'xbench': {
    id: 'xbench',
    category: 'research',
    name: 'xbench',
    description: '中文搜索评测：约 200 道事实查询问题。',
    icon: Globe,
    formatDescription: '格式： id （编号）, prompt （输入）, type （元数据）, answer （预期答案）',
    requiredFields: ['prompt', 'answer'],
    optionalFields: ['type', 'id'],
    fieldInference: {
      input: ['prompt', 'question', 'input'],
      expected: ['answer', 'response'],
      choices: [],
      category: ['type', 'category'],
      sortOrder: ['id'],
    },
    validation: {
      requireExpected: true,
      expectedFormat: 'string',
    },
  },

  // === Reference Formats (low priority) ===
  'mmlu': {
    id: 'mmlu',
    category: 'reference',
    name: 'MMLU（参考）',
    description: '选择题格式（仅供参考）',
    icon: Globe,
    formatDescription: '格式： question, choices 数组（或 A/B/C/D 列）, answer （索引/字母）',
    requiredFields: ['question', 'choices', 'answer'],
    optionalFields: ['subject', 'difficulty'],
    fieldInference: {
      input: ['question', 'prompt', 'query'],
      expected: ['answer', 'correct_answer', 'label'],
      choices: ['choices', 'options', 'A', 'B', 'C', 'D'],
      category: ['context', 'subject', 'category'],
    },
    validation: {
      requireExpected: true,
      requireChoices: true,
      expectedFormat: 'index',
    },
  },

  // === Custom ===
  'custom': {
    id: 'custom',
    category: 'custom',
    name: '自定义',
    description: '自定义字段映射',
    icon: Database,
    formatDescription: '自定义格式：由你配置字段映射，必须包含 input 字段。',
    requiredFields: ['input'],
    optionalFields: ['expected', 'choices', 'category', 'metadata'],
    fieldInference: {
      input: ['input', 'question', 'prompt', 'query'],
      expected: ['expected', 'answer', 'output', 'response'],
      choices: ['choices', 'options'],
      category: ['category', 'type', 'topic', 'subject'],
    },
  },
};

export const getPresetById = (id?: string): DatasetPreset => {
  return DATASET_PRESETS[id || 'custom'] || DATASET_PRESETS.custom;
};

// Get Presets grouped by category
export const getPresetsByCategory = (): Record<PresetCategory, DatasetPreset[]> => {
  const grouped: Record<string, DatasetPreset[]> = {
    'research': [],
    'tool-use': [],
    'memory': [],
    'reference': [],
    'custom': [],
  };

  Object.values(DATASET_PRESETS).forEach((preset) => {
    if (!grouped[preset.category]) {
      grouped[preset.category] = [];
    }
    grouped[preset.category].push(preset);
  });

  return grouped as Record<PresetCategory, DatasetPreset[]>;
};
