'use client';

/**
 * Lifecycle modes the devtools gallery can swap between, each one shapes the
 * props handed to renderers/inspectors so they preview a specific moment in a
 * tool call's life.
 */
export type LifecycleMode =
  'streaming' | 'loading' | 'success' | 'error' | 'placeholder' | 'intervention';

export const LIFECYCLE_MODES: LifecycleMode[] = [
  'streaming',
  'loading',
  'success',
  'error',
  'placeholder',
  'intervention',
];

export const LIFECYCLE_MODE_LABEL: Record<LifecycleMode, string> = {
  error: '错误',
  intervention: '等待干预',
  loading: '加载中',
  placeholder: '占位状态',
  streaming: '流式输出',
  success: '成功',
};

export type FixtureBodyKind = 'render' | 'streaming' | 'placeholder' | 'intervention';

export const FIXTURE_BODY_KIND_LABEL: Record<FixtureBodyKind, string> = {
  intervention: '等待干预',
  placeholder: '占位内容',
  render: '结果渲染',
  streaming: '流式内容',
};

/**
 * Map a lifecycle mode to the body slot it targets. Streaming/placeholder/
 * intervention have dedicated component slots; everything else feeds the Render
 * slot with mode-specific props.
 */
export const bodyKindForMode = (mode: LifecycleMode): FixtureBodyKind => {
  switch (mode) {
    case 'streaming': {
      return 'streaming';
    }
    case 'placeholder': {
      return 'placeholder';
    }
    case 'intervention': {
      return 'intervention';
    }
    default: {
      return 'render';
    }
  }
};

export interface ToolRenderFixtureVariant {
  args?: Record<string, unknown>;
  content?: unknown;
  description?: string;
  id: string;
  label: string;
  /** Override the auto-derived partialArgs for streaming mode. */
  partialArgs?: Record<string, unknown>;
  /** Optional override for what to surface in error mode. */
  pluginError?: unknown;
  pluginState?: any;
}

export interface ToolRenderFixture {
  variants: ToolRenderFixtureVariant[];
}

/** Truncate string fields and arrays so streaming mode looks "in progress". */
const derivePartialArgs = (args: Record<string, unknown> | undefined) => {
  if (!args) return {};
  const entries = Object.entries(args);
  if (entries.length === 0) return {};

  // Drop the last field to suggest the model is still typing the next key.
  const visible = entries.length > 1 ? entries.slice(0, -1) : entries;

  return Object.fromEntries(
    visible.map(([key, value]) => {
      if (typeof value === 'string') {
        // Keep half the string so the inspector still has something readable.
        const cutoff = Math.max(8, Math.floor(value.length / 2));
        return [key, value.length > cutoff ? `${value.slice(0, cutoff)}…` : value];
      }
      if (Array.isArray(value)) {
        return [key, value.slice(0, Math.max(1, Math.ceil(value.length / 2)))];
      }
      return [key, value];
    }),
  );
};

/**
 * For error mode, mutate a success-shaped pluginState into a failure shape so
 * inspectors that check `success`/`exitCode`/etc. light up the failure path.
 */
const deriveErrorState = (variant: ToolRenderFixtureVariant) => {
  if (variant.pluginState && typeof variant.pluginState === 'object') {
    return {
      ...variant.pluginState,
      error: '调试工具模拟错误：命令执行失败',
      exitCode: 1,
      success: false,
    };
  }
  return {
    error: '调试工具模拟错误：命令执行失败',
    success: false,
  };
};

const deriveErrorPayload = (variant: ToolRenderFixtureVariant) =>
  variant.pluginError ?? {
    body: '调试工具模拟错误：底层执行器在返回结果前发生异常。',
    message: '工具执行失败',
    type: 'PluginServerError',
  };

export interface DerivedFixtureProps {
  args: Record<string, unknown>;
  content: unknown;
  isArgumentsStreaming: boolean;
  isLoading: boolean;
  partialArgs: Record<string, unknown> | undefined;
  pluginError: unknown;
  pluginState: any;
}

/**
 * Reshape a fixture variant into the props a render/inspector should receive
 * for the given lifecycle mode.
 */
export const deriveFixtureProps = (
  variant: ToolRenderFixtureVariant,
  mode: LifecycleMode,
): DerivedFixtureProps => {
  const args = variant.args ?? {};
  const partial = variant.partialArgs ?? derivePartialArgs(variant.args);

  switch (mode) {
    case 'streaming': {
      return {
        args: partial,
        content: '',
        isArgumentsStreaming: true,
        isLoading: false,
        partialArgs: partial,
        pluginError: undefined,
        pluginState: undefined,
      };
    }
    case 'loading': {
      return {
        args,
        content: '',
        isArgumentsStreaming: false,
        isLoading: true,
        partialArgs: undefined,
        pluginError: undefined,
        pluginState: undefined,
      };
    }
    case 'error': {
      return {
        args,
        content: variant.content ?? '',
        isArgumentsStreaming: false,
        isLoading: false,
        partialArgs: undefined,
        pluginError: deriveErrorPayload(variant),
        pluginState: deriveErrorState(variant),
      };
    }
    // success / placeholder / intervention all get the "completed" props shape.
    default: {
      return {
        args,
        content: variant.content ?? '',
        isArgumentsStreaming: false,
        isLoading: false,
        partialArgs: undefined,
        pluginError: undefined,
        pluginState: variant.pluginState,
      };
    }
  }
};
