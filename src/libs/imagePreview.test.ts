import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error The upstream internal entry has no declaration file.
import Image from '../../node_modules/@lobehub/ui/es/Image/Image.mjs';
// @ts-expect-error The upstream internal entry has no declaration file.
import PreviewGroup from '../../node_modules/@lobehub/ui/es/Image/PreviewGroup.mjs';
// Exercise the installed dependency that our persisted patch changes.
// @ts-expect-error The upstream internal hook has no declaration file.
import { useViewerGestures } from '../../node_modules/@lobehub/ui/es/Image/viewer/useViewerGestures.mjs';
// @ts-expect-error The upstream internal hook has no declaration file.
import { useZoomPan } from '../../node_modules/@lobehub/ui/es/Image/viewer/useZoomPan.mjs';

const setup = () => {
  const onClose = vi.fn();
  const hook = renderHook(() => {
    const zoom = useZoomPan({
      defaultZoom: 'fit',
      natural: { height: 1600, width: 900 },
      onCloseRequest: onClose,
      viewport: { height: 900, width: 1400 },
    });
    return { gestures: useViewerGestures({ ...zoom, onClose }), zoom };
  });
  return { ...hook, onClose };
};

const wheel = (deltaY: number, deltaMode = 0) =>
  new WheelEvent('wheel', { cancelable: true, clientX: 700, clientY: 450, deltaMode, deltaY });

afterEach(() => vi.useRealTimers());

describe('image preview close policy', () => {
  it('switches both ways with gallery buttons without dismissing the preview', async () => {
    render(
      createElement(
        PreviewGroup,
        {},
        createElement(Image, {
          alt: 'First image',
          src: '/first.png',
          preview: { animated: false },
        }),
        createElement(Image, {
          alt: 'Second image',
          src: '/second.png',
          preview: { animated: false },
        }),
      ),
    );
    for (const thumbnail of screen.getAllByRole('img')) {
      Object.defineProperties(thumbnail, {
        naturalHeight: { value: 1600 },
        naturalWidth: { value: 900 },
      });
      vi.spyOn(thumbnail, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 225, 400));
    }
    fireEvent.click(screen.getByRole('img', { name: 'First image' }));
    const first = await screen.findByRole('dialog', { name: 'First image' });
    fireEvent.click(first.querySelector('button:has(svg.lucide-chevron-right)')!);
    const second = await screen.findByRole('dialog', { name: 'Second image' });
    await waitFor(() =>
      expect(second.querySelector('img:not([data-ghost])')?.getAttribute('src')).toMatch(
        /\/second\.png$/,
      ),
    );
    fireEvent.click(second.querySelector('button:has(svg.lucide-chevron-left)')!);
    expect(await screen.findByRole('dialog', { name: 'First image' })).toBeVisible();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it.each(['Escape', 'close button', 'blank area'])(
    'closes a zoomed preview using %s',
    async (method) => {
      render(
        createElement(Image, {
          alt: 'Preview test',
          preview: { defaultZoom: 'fit' },
          src: '/test.png',
        }),
      );
      const thumbnail = screen.getByRole('img', { name: 'Preview test' });
      Object.defineProperties(thumbnail, {
        naturalHeight: { value: 1600 },
        naturalWidth: { value: 900 },
      });
      vi.spyOn(thumbnail, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 225, 400));
      fireEvent.click(thumbnail);
      const dialog = await screen.findByRole('dialog', { name: 'Preview test' });
      fireEvent.wheel(dialog, { clientX: 700, clientY: 450, deltaY: -120 });
      fireEvent.click(dialog.querySelector('img')!);
      expect(screen.getByRole('dialog', { name: 'Preview test' })).toBe(dialog);
      if (method === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' });
      else if (method === 'blank area') fireEvent.click(dialog);
      else fireEvent.click(dialog.querySelector('button:has(svg.lucide-x)')!);
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Preview test' })).toBeNull(),
      );
    },
  );

  it('only dismisses a direct blank-surface click, never a bubbled control click', () => {
    const { onClose, result } = setup();
    const surface = document.createElement('div');
    const button = document.createElement('button');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    button.append(arrow);
    surface.append(button);
    for (const target of [button, arrow]) {
      act(() =>
        result.current.gestures.onSurfaceClick({
          currentTarget: surface,
          target,
          stopPropagation: vi.fn(),
        }),
      );
    }
    expect(onClose).not.toHaveBeenCalled();
    act(() =>
      result.current.gestures.onSurfaceClick({
        currentTarget: surface,
        target: surface,
        stopPropagation: vi.fn(),
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when a control press is retargeted to the surface on release', () => {
    const { onClose, result } = setup();
    const surface = document.createElement('div');
    const button = document.createElement('button');
    surface.append(button);
    act(() => {
      result.current.gestures.onPointerDown({
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
        target: button,
        currentTarget: surface,
      });
      result.current.gestures.onPointerFinish({ pointerId: 1 });
      result.current.gestures.onSurfaceClick({
        target: surface,
        currentTarget: surface,
        stopPropagation: vi.fn(),
      });
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      result.current.gestures.onPointerDown({
        button: 0,
        pointerId: 2,
        clientX: 100,
        clientY: 100,
        target: surface,
        currentTarget: surface,
      });
      result.current.gestures.onPointerFinish({ pointerId: 2 });
      result.current.gestures.onSurfaceClick({
        target: surface,
        currentTarget: surface,
        stopPropagation: vi.fn(),
      });
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([0, 1, 2])('keeps the preview open at minimum zoom for wheel mode %s', (mode) => {
    const { onClose, result } = setup();
    act(() => {
      for (let i = 0; i < 5; i++) result.current.zoom.handleWheel(wheel(120, mode));
    });
    expect(result.current.zoom.scale.get()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still zooms in and out with the wheel', () => {
    const { onClose, result } = setup();
    act(() => result.current.zoom.handleWheel(wheel(-120)));
    const enlarged = result.current.zoom.scale.get();
    expect(enlarged).toBeGreaterThan(1);
    act(() => result.current.zoom.handleWheel(wheel(20)));
    expect(result.current.zoom.scale.get()).toBeLessThan(enlarged);
    expect(result.current.zoom.scale.get()).toBeGreaterThanOrEqual(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not dismiss when clicking the image', () => {
    vi.useFakeTimers();
    const { onClose, result } = setup();
    act(() => {
      result.current.gestures.onImageClick({ stopPropagation: vi.fn() });
      vi.advanceTimersByTime(300);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
