import type { CSSProperties } from 'react';

export const page: CSSProperties = { padding: 24, display: 'flex', flexDirection: 'column', gap: 28 };
export const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 };

export function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}
