import { AppLink } from '@/ds';
import styles from './Chrome.module.css';
import logo from './Brand.module.css';

export interface BrandProps {
  /** Draws the horizontal lockup (icon and name); without it, the icon alone. */
  withName?: boolean;
  /** The icon's size; the lockup is drawn 1.6 times as tall, which sets its name at about the size of body text. */
  size?: 20 | 26 | 36;
  href?: string;
}

/** The lockup's viewBox is 4:1 (public/agent-desk-horizontal.svg). */
const LOCKUP_RATIO = 4;
const LOCKUP_HEIGHT_PER_ICON = 1.6;

/** The ticket-and-nodes mark, in the 120-unit space both drawings share. */
function Mark() {
  return (
    <>
      <path
        d="M34 8H86C95 8 102 15 102 24V34C94 37 94 49 102 52V62C102 71 95 78 86 78H34C25 78 18 71 18 62V52C26 49 26 37 18 34V24C18 15 25 8 34 8Z"
        fill="none"
        className={logo.ink}
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <path
        d="M39 31L53 43L39 55"
        fill="none"
        className={logo.ink}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M58 56H70" fill="none" className={logo.ink} strokeWidth="6" strokeLinecap="round" />
      <path d="M77 27V42C77 49 82 53 88 53" fill="none" className={logo.violet} strokeWidth="5" strokeLinecap="round" />
      <circle cx="77" cy="24" r="7" className={logo.node} />
      <circle cx="91" cy="55" r="7" className={logo.teal} />
    </>
  );
}

/**
 * The Agent Desk logo icon, the same drawing as public/agent-desk-icon.svg (the favicon); branding.test.ts fails if
 * the two drift. It is inline SVG, not an <img>, so it needs no request and no markup-injection guard sees an image
 * element in the page.
 * Its colours are the --logo-* tokens in tokens.css, applied by Brand.module.css classes (SVG attributes do not take
 * var(), and inline style is not allowed for colour). They do not follow the theme.
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
      <rect x="0" y="0" width="120" height="120" rx="27" className={logo.bg} />
      <g transform="translate(2 21) scale(1.08)">
        <Mark />
      </g>
    </svg>
  );
}

const WORD = {
  y: 79,
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
  fontSize: 54,
  fontWeight: 750,
  letterSpacing: -2.4,
};

/**
 * The horizontal lockup, the same drawing as public/agent-desk-horizontal.svg (icon plus the name in the same svg);
 * branding.test.ts fails if the shapes or words drift. Inline for the reason above. The file is inked for a light
 * page (dark name); the app bar is dark, so the same shapes take the --logo-* tokens, as the icon does.
 */
function Lockup({ height, label }: { height: number; label: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={height * LOCKUP_RATIO}
      height={height}
      viewBox="0 0 480 120"
      role="img"
      aria-label={label}
    >
      <g transform="translate(0 18) scale(1.1)">
        <Mark />
      </g>
      <text x="142" {...WORD} className={logo.wordInk}>
        Agent <tspan className={logo.node}>Desk</tspan>
      </text>
    </svg>
  );
}

export function Brand({ withName = true, size = 20, href }: BrandProps) {
  // The lockup carries the name in its drawing, so it is the product's name for a screen reader like the lone icon.
  const glyph = withName ? (
    <Lockup height={Math.round(size * LOCKUP_HEIGHT_PER_ICON)} label="Agent Desk" />
  ) : (
    <Logo size={size} label="Agent Desk" />
  );
  if (!href) return <span className={styles.brand}>{glyph}</span>;
  return (
    <AppLink href={href} className={styles.brand} aria-label="Agent Desk, all projects">
      {glyph}
    </AppLink>
  );
}
