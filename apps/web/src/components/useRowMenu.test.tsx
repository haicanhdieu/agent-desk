import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRowMenu } from './useRowMenu';

const MENU = 200;
const original = { height: window.innerHeight, width: window.innerWidth };

function setViewport(height: number, width = 1000) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

/** Opens the menu with the More button's box at `top`..`bottom`, right edge at `right`. */
function openAt(box: { top: number; bottom: number; right: number }, menuHeight: number | null = MENU) {
  const { result } = renderHook(() => useRowMenu(menuHeight ?? undefined));
  const el = document.createElement('span');
  el.getBoundingClientRect = () => ({ ...box, left: 0, x: 0, y: box.top, width: 0, height: 0, toJSON: () => ({}) });
  result.current.moreRef.current = el;
  act(() => result.current.toggleMenu());
  return result.current;
}

describe('useRowMenu placement', () => {
  beforeEach(() => setViewport(600));
  afterEach(() => setViewport(original.height, original.width));

  it('opens downward when the menu fits under the button', () => {
    const { menuAt, open } = openAt({ top: 100, bottom: 130, right: 900 });
    expect(open).toBe(true);
    expect(menuAt).toEqual({ top: 134, right: 100 });
  });

  it('opens upward when it does not fit below but fits above', () => {
    const { menuAt } = openAt({ top: 500, bottom: 530, right: 900 });
    expect(menuAt).toEqual({ bottom: 104, right: 100 });
  });

  it('opens downward when it fits neither below nor above', () => {
    setViewport(300);
    const { menuAt } = openAt({ top: 150, bottom: 180, right: 900 });
    expect(menuAt).toEqual({ top: 184, right: 100 });
  });

  it('opens downward when no menu height is given', () => {
    const { menuAt } = openAt({ top: 500, bottom: 530, right: 900 }, null);
    expect(menuAt).toEqual({ top: 534, right: 100 });
  });
});
