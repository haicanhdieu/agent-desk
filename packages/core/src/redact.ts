interface TokenPattern {
  /** Literal start of the token. */
  prefix: string;
  /** One character of the token body, as a regex source. */
  body: string;
  /** Fewest body characters of a whole token. */
  min: number;
  /** Literal that ends a whole token, if any. */
  suffix?: string;
}

const TOKEN_PATTERNS: TokenPattern[] = [
  { prefix: 'x-access-token:', body: '[^@\\s]', min: 1, suffix: '@' },
  { prefix: 'ghs_', body: '[A-Za-z0-9]', min: 20 },
  { prefix: 'sk-ant-', body: '[A-Za-z0-9_-]', min: 10 },
];

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PATTERNS = TOKEN_PATTERNS.map(
  (p) => new RegExp(`${escape(p.prefix)}${p.body}{${p.min},}${escape(p.suffix ?? '')}`, 'g'),
);
/** What a cut leaves of each pattern: the prefix and a body so far, at the end of the text. */
const UNFINISHED = TOKEN_PATTERNS.map((p) => new RegExp(`${escape(p.prefix)}${p.body}*$`));

/** Shortest cut piece of a pattern's literal start that counts as the start of a token (shorter ones hold no secret). */
const MIN_CUT_PREFIX = 4;

/** Replaces every given secret and well-known token pattern with `***`. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  // Longest first so a secret that contains another is replaced whole.
  for (const s of [...secrets].filter((x) => x.length > 0).sort((a, b) => b.length - a.length)) {
    out = out.split(s).join('***');
  }
  for (const p of PATTERNS) out = out.replace(p, '***');
  return out;
}

/**
 * Where a token that the end of `text` leaves unfinished starts (a text that was cut can end inside a token, which no
 * pattern in `redact` then matches): the earliest such start, or the text's length when it ends in none. The start can be
 * the whole literal start with a body so far, or a cut piece of the literal start at least MIN_CUT_PREFIX long.
 */
export function unfinishedTokenStart(text: string): number {
  let start = text.length;
  for (const tail of UNFINISHED) {
    const m = tail.exec(text);
    if (m) start = Math.min(start, m.index);
  }
  for (const { prefix } of TOKEN_PATTERNS) {
    for (let k = Math.min(prefix.length, text.length); k >= MIN_CUT_PREFIX; k -= 1) {
      if (text.endsWith(prefix.slice(0, k))) {
        start = Math.min(start, text.length - k);
        break;
      }
    }
  }
  return start;
}
