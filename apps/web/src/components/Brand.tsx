import { AppLink } from '@/ds';
import styles from './Chrome.module.css';

export interface BrandProps {
  withName?: boolean;
  size?: 20 | 26 | 36;
  href?: string;
}

/**
 * The Agent Desk logo icon, the same drawing as public/agent-desk-icon.svg (the favicon); branding.test.ts fails if
 * the two drift. It is inline SVG, not an <img>, so it needs no request and no markup-injection guard sees an image
 * element in the page.
 * Judgment call: the colours below are hard-coded because they must match the favicon file and must not follow the
 * theme. docs/conventions/frontend.md §5 has no exception for brand artwork (no raw colours outside tokens.css), so
 * review may prefer brand tokens instead.
 */
function Logo({ size, label }: { size: number; label?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <rect x="0" y="0" width="120" height="120" rx="27" fill="#111827" />
      <g transform="translate(2 21) scale(1.08)">
        <path
          d="M34 8H86C95 8 102 15 102 24V34C94 37 94 49 102 52V62C102 71 95 78 86 78H34C25 78 18 71 18 62V52C26 49 26 37 18 34V24C18 15 25 8 34 8Z"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="7"
          strokeLinejoin="round"
        />
        <path
          d="M39 31L53 43L39 55"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M58 56H70" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
        <path d="M77 27V42C77 49 82 53 88 53" fill="none" stroke="#756EFF" strokeWidth="5" strokeLinecap="round" />
        <circle cx="77" cy="24" r="7" fill="#756EFF" />
        <circle cx="91" cy="55" r="7" fill="#20C9B0" />
      </g>
    </svg>
  );
}

export function Brand({ withName = true, size = 20, href }: BrandProps) {
  // Decorative when the text beside it names the product; otherwise it is the only name there is.
  const glyph = <Logo size={size} label={withName ? undefined : 'Agent Desk'} />;
  if (!href) {
    return (
      <span className={styles.brand}>
        {glyph}
        {withName && 'Agent Desk'}
      </span>
    );
  }
  return (
    <AppLink href={href} className={styles.brand} aria-label="Agent Desk, all projects">
      {glyph}
      {withName && 'Agent Desk'}
    </AppLink>
  );
}
