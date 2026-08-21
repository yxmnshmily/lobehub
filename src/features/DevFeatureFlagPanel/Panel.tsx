'use client';

import { Flexbox, Input } from '@lobehub/ui';
import { Button, Switch, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { snakeCase } from 'es-toolkit/compat';
import { ListRestartIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';
import {
  type FeatureFlagKey,
  isFeatureFlagOverridable,
} from '@/store/serverConfig/slices/featureFlagOverride/action';

import FlagRow from './FlagRow';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: auto;
    flex: 1;

    min-height: 0;
    padding-block: 4px;
    padding-inline: 4px;
  `,
  container: css`
    display: flex;
    flex-direction: column;

    width: 100%;
    max-width: 720px;
    height: 100%;
    margin-inline: auto;
  `,
  empty: css`
    padding-block: 32px;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
    text-align: center;
  `,
  footer: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  toolbar: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const Panel = memo(() => {
  const originalFlags = useServerConfigStore((s) => s._originalFeatureFlags);
  const overrideCount = useServerConfigStore((s) => Object.keys(s._featureFlagOverrides).length);
  const overrides = useServerConfigStore((s) => s._featureFlagOverrides);
  const resetFlagOverrides = useServerConfigStore((s) => s.resetFlagOverrides);

  const [search, setSearch] = useState('');
  const [overriddenOnly, setOverriddenOnly] = useState(false);

  const flagKeys = useMemo<FeatureFlagKey[]>(() => {
    if (!originalFlags) return [];
    return (Object.keys(originalFlags) as (keyof typeof originalFlags)[])
      .filter(isFeatureFlagOverridable)
      .sort();
  }, [originalFlags]);

  const visibleKeys = useMemo(() => {
    const term = search.trim().toLowerCase();
    return flagKeys.filter((key) => {
      if (overriddenOnly && overrides[key] === undefined) return false;
      if (!term) return true;
      return snakeCase(key as string).includes(term);
    });
  }, [flagKeys, overrides, overriddenOnly, search]);

  if (!originalFlags) return <div className={styles.empty}>服务器功能开关尚未加载。</div>;

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <Input
          allowClear
          placeholder={'搜索功能开关键名…'}
          size={'small'}
          style={{ flex: 1 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Flexbox horizontal align={'center'} gap={6}>
          <Switch checked={overriddenOnly} size={'small'} onChange={setOverriddenOnly} />
          <Text style={{ fontSize: 12, whiteSpace: 'nowrap' }} type={'secondary'}>
            仅显示已覆盖项
          </Text>
        </Flexbox>
      </div>

      <div className={styles.body}>
        {visibleKeys.length === 0 ? (
          <div className={styles.empty}>没有匹配的功能开关</div>
        ) : (
          visibleKeys.map((key) => <FlagRow flagKey={key} key={key} />)
        )}
      </div>

      <div className={styles.footer}>
        <Text style={{ fontSize: 11 }} type={'secondary'}>
          已启用 {overrideCount} 项覆盖 · 客户端生效 · 保存在本地存储中
        </Text>
        <Button
          disabled={overrideCount === 0}
          icon={ListRestartIcon}
          size={'small'}
          onClick={resetFlagOverrides}
        >
          全部重置
        </Button>
      </div>
    </div>
  );
});

Panel.displayName = 'DevFeatureFlagPanel/Panel';

export default Panel;
