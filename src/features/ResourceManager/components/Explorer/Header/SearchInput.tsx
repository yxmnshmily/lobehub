'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { useDebounce } from 'ahooks';
import { Input } from 'antd';
import { SearchIcon, XIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/features/ResourceManager/store';

const SearchInput = memo<{ mobile?: boolean }>(({ mobile = false }) => {
  const { t } = useTranslation('components');
  const [expanded, setExpanded] = useState(false);
  const [localQuery, setLocalQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);
  const inputRef = useRef<any>(null);
  const setSearchQuery = useResourceManagerStore((s) => s.setSearchQuery);

  const debouncedQuery = useDebounce(localQuery, { wait: 350 });

  useEffect(() => {
    if (!expanded) return;
    setSearchQuery(debouncedQuery || null);
  }, [debouncedQuery, expanded, setSearchQuery]);

  const handleExpand = useCallback(() => {
    setExpanded(true);
  }, []);

  const handleCollapse = useCallback(
    (returnFocus = false) => {
      returnFocusRef.current = returnFocus;
      setExpanded(false);
      setLocalQuery('');
      setSearchQuery(null);
    },
    [setSearchQuery],
  );

  const handleBlur = useCallback(() => {
    if (!localQuery) {
      handleCollapse();
    }
  }, [localQuery, handleCollapse]);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
    else if (returnFocusRef.current) {
      triggerRef.current?.focus();
      returnFocusRef.current = false;
    }
  }, [expanded]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCollapse(true);
      }
    },
    [handleCollapse],
  );

  return (
    <>
      <div
        style={{
          opacity: expanded ? 1 : 0,
          overflow: 'hidden',
          transition: 'opacity 200ms ease-out',
          width: expanded ? 200 : 0,
        }}
      >
        {expanded && (
          <Input
            aria-label={t('FileManager.search.placeholder')}
            placeholder={t('FileManager.search.placeholder')}
            prefix={<SearchIcon size={14} />}
            ref={inputRef}
            size={mobile ? 'middle' : 'small'}
            style={{ height: mobile ? 44 : undefined, width: 200 }}
            value={localQuery}
            suffix={
              localQuery ? (
                <ActionIcon
                  aria-label={t('FileManager.search.clear')}
                  icon={XIcon}
                  size={14}
                  style={{ minHeight: mobile ? 44 : undefined, minWidth: mobile ? 44 : undefined }}
                  onClick={() => handleCollapse(true)}
                />
              ) : undefined
            }
            onBlur={handleBlur}
            onChange={(e) => setLocalQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        )}
      </div>
      {!expanded && (
        <ActionIcon
          aria-label={t('FileManager.search.placeholder')}
          icon={SearchIcon}
          ref={triggerRef}
          title={t('FileManager.search.placeholder')}
          style={{
            marginRight: 4,
            minHeight: mobile ? 44 : undefined,
            minWidth: mobile ? 44 : undefined,
          }}
          onClick={handleExpand}
        />
      )}
    </>
  );
});

SearchInput.displayName = 'SearchInput';

export default SearchInput;
