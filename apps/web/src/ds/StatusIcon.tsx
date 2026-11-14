import type { ReactNode } from 'react';
import { statusTokens, type RunStatus } from './tokens';

export interface StatusIconProps {
  status: RunStatus;
  size?: 12 | 14 | 16 | 18 | 20;
  title?: string;
  /** Follow the surrounding text colour instead of the status colour (solid amber pill). */
  inheritColor?: boolean;
}

/** 16 viewBox glyphs from the prototype; shape (not just colour) encodes status. */
const glyphs: Record<RunStatus, ReactNode> = {
  queued: <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  starting: (
    <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 2.4" />
  ),
  running: (
    <>
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".45" />
      <circle cx="8" cy="8" r="3.4" fill="currentColor" />
    </>
  ),
  idle: (
    <>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <rect x="7.1" y="4" width="1.8" height="8" rx=".6" fill="var(--on-idle)" />
    </>
  ),
  done: (
    <>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <rect x="7.1" y="4" width="1.8" height="8" rx=".6" fill="var(--on-idle)" />
    </>
  ),
  succeeded: (
    <>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path
        d="M4.8 8.2l2.2 2.2 4.2-4.6"
        fill="none"
        stroke="var(--on-ok)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  failed: (
    <>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="var(--on-danger)" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  timed_out: (
    <>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M8 4.6V8.3l2.4 1.5" fill="none" stroke="var(--on-late)" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  cancelled: (
    <>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 12 12 4" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
};

export function StatusIcon({ status, size = 14, title, inheritColor }: StatusIconProps) {
  const token = statusTokens[status] ?? statusTokens.queued;
  const glyph = glyphs[status] ?? glyphs.queued;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={inheritColor ? { flex: '0 0 auto' } : { color: `var(${token.colorVar})`, flex: '0 0 auto' }}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      {glyph}
    </svg>
  );
}
