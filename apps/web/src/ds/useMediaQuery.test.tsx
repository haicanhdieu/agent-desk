import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setViewportWidth } from '@/test/fakeMatchMedia';
import { BELOW_DESKTOP, PHONE, useMediaQuery } from './useMediaQuery';

describe('useMediaQuery', () => {
  it('follows the viewport width across the 1024px desktop breakpoint', () => {
    const { result } = renderHook(() => useMediaQuery(BELOW_DESKTOP));
    expect(result.current).toBe(false);
    act(() => setViewportWidth(1023));
    expect(result.current).toBe(true);
    act(() => setViewportWidth(1024));
    expect(result.current).toBe(false);
  });

  it('reads the current width on first render', () => {
    setViewportWidth(390);
    const { result } = renderHook(() => useMediaQuery(PHONE));
    expect(result.current).toBe(true);
  });

  it('phone ends at 639px', () => {
    const { result } = renderHook(() => useMediaQuery(PHONE));
    act(() => setViewportWidth(639));
    expect(result.current).toBe(true);
    act(() => setViewportWidth(640));
    expect(result.current).toBe(false);
  });
});
