'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { CheckIcon, GlobeIcon } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { LOBE_LOCALE_COOKIE } from '@/const/locale';
import { localeOptions, normalizeLocale } from '@/locales/resources';
import { useTravelTranslation } from '@/utils/i18n/travel';

const setCookieSimple = (key: string, value: string, days: number) => {
  const expires = new Date(Date.now() + days * 86_400_000).toUTCString();
  document.cookie = `${key}=${value};expires=${expires};path=/;`;
};

const AuthLangButton = memo(() => {
  const translateTravel = useTravelTranslation();
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ bottom: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const browserLanguage = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN';
  const current = normalizeLocale(i18n.language || i18n.resolvedLanguage || browserLanguage);
  const currentLabel =
    localeOptions.find((item) => item.value === current)?.label || translateTravel('简体中文');

  const getMenuItems = useCallback(
    () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || [],
      ),
    [],
  );

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const rows = getMenuItems();
    (rows.find((row) => row.getAttribute('aria-checked') === 'true') || rows[0])?.focus();
  }, [getMenuItems, open]);

  const changeLanguage = useCallback(
    (language: string) => {
      void i18n.changeLanguage(language);
      document.documentElement.lang = language;
      setCookieSimple(LOBE_LOCALE_COOKIE, language, 365);
      closeMenu();
    },
    [closeMenu, i18n],
  );

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = getMenuItems();
    if (rows.length === 0) return;

    const activeIndex = Math.max(0, rows.indexOf(document.activeElement as HTMLButtonElement));
    let nextIndex: number | undefined;

    switch (event.key) {
      case 'ArrowDown': {
        nextIndex = (activeIndex + 1) % rows.length;
        break;
      }
      case 'ArrowUp': {
        nextIndex = (activeIndex - 1 + rows.length) % rows.length;
        break;
      }
      case 'End': {
        nextIndex = rows.length - 1;
        break;
      }
      case 'Escape': {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      case 'Home': {
        nextIndex = 0;
        break;
      }
      case 'Tab': {
        nextIndex = (activeIndex + (event.shiftKey ? -1 : 1) + rows.length) % rows.length;
        break;
      }
      default: {
        return;
      }
    }

    event.preventDefault();
    rows[nextIndex].focus();
  };

  const handleOverlayPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || !menuRef.current) return;

    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > 8) return;

    const menuRect = menuRef.current.getBoundingClientRect();
    const insideMenu =
      event.clientX >= menuRect.left &&
      event.clientX <= menuRect.right &&
      event.clientY >= menuRect.top &&
      event.clientY <= menuRect.bottom;

    if (!insideMenu) {
      closeMenu();
      return;
    }

    const rows = Array.from(
      menuRef.current.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    );
    const rowIndex = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom;
    });

    if (rowIndex >= 0) changeLanguage(localeOptions[rowIndex].value);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <Button
        aria-expanded={open}
        aria-haspopup="menu"
        icon={GlobeIcon}
        iconPosition="end"
        size="small"
        type="text"
        style={{
          height: 44,
          paddingInline: 8,
        }}
        onClick={() => {
          if (!open && rootRef.current) {
            const rect = rootRef.current.getBoundingClientRect();
            setMenuPosition({
              bottom: Math.max(8, window.innerHeight - rect.top + 4),
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 208)),
            });
          }
          setOpen((value) => !value);
        }}
      >
        <Text fontSize={12}>{currentLabel}</Text>
      </Button>
      {open &&
        createPortal(
          <div
            data-testid="language-menu-overlay"
            style={{
              inset: 0,
              pointerEvents: 'auto',
              position: 'fixed',
              zIndex: 2_147_483_647,
            }}
            onKeyDown={handleMenuKeyDown}
            onPointerUp={handleOverlayPointerUp}
            onPointerCancel={() => {
              pointerStartRef.current = null;
            }}
            onPointerDown={(event) => {
              pointerStartRef.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerMove={(event) => {
              const start = pointerStartRef.current;
              if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
                pointerStartRef.current = null;
              }
            }}
          >
            <div
              aria-label={translateTravel('语言')}
              ref={menuRef}
              role="menu"
              style={{
                background: 'Canvas',
                border: '0.5px solid color-mix(in srgb, CanvasText 28%, transparent)',
                borderRadius: 8,
                bottom: menuPosition.bottom,
                boxShadow: '0 8px 28px rgba(0, 0, 0, 0.18)',
                color: 'CanvasText',
                left: menuPosition.left,
                maxHeight: 'min(60dvh, 360px)',
                minWidth: 200,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                paddingBlock: 4,
                pointerEvents: 'auto',
                position: 'absolute',
                touchAction: 'pan-y',
              }}
            >
              {localeOptions.map((item) => {
                const selected = current === item.value;

                return (
                  <button
                    aria-checked={selected}
                    key={item.value}
                    role="menuitemradio"
                    tabIndex={selected ? 0 : -1}
                    type="button"
                    style={{
                      alignItems: 'center',
                      appearance: 'none',
                      background: 'transparent',
                      border: 0,
                      color: 'inherit',
                      cursor: 'pointer',
                      display: 'flex',
                      font: 'inherit',
                      gap: 8,
                      minHeight: 44,
                      padding: '8px 12px',
                      pointerEvents: 'auto',
                      textAlign: 'start',
                      touchAction: 'manipulation',
                      width: '100%',
                    }}
                    onClick={() => changeLanguage(item.value)}
                  >
                    <Flexbox align="center" justify="center" style={{ flex: '0 0 16px' }}>
                      {selected && <CheckIcon aria-hidden size={14} />}
                    </Flexbox>
                    <Text style={{ lineHeight: 1.2 }}>{item.label}</Text>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
});

AuthLangButton.displayName = 'AuthLangButton';

export default AuthLangButton;
