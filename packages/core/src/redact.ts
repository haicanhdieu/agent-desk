interface TokenPattern {
  /** Literal start of the token. */
  prefix: string;
  /** One character of the token body, as a regex source. */
  body: string;
  /** Fewest body characters of a whole token. */
  min: number;
  /** Literal that ends a whole token, if any. */
  suffix?: string;
  /**
   * Most body characters a whole token has. Only for a pattern that needs its suffix: with no suffix after it, every
   * start of the prefix would scan the whole rest of the text, which is quadratic on a hostile text.
   */
  max?: number;
}

const TOKEN_PATTERNS: TokenPattern[] = [
  { prefix: 'x-access-token:', body: '[^@\\s]', min: 1, max: 512, suffix: '@' },
  { prefix: 'ghs_', body: '[A-Za-z0-9]', min: 20 },
  // GitHub classic user, OAuth, user-to-server and refresh tokens (36 body chars) and fine-grained tokens.
  { prefix: 'ghp_', body: '[A-Za-z0-9]', min: 36 },
  { prefix: 'gho_', body: '[A-Za-z0-9]', min: 36 },
  { prefix: 'ghu_', body: '[A-Za-z0-9]', min: 36 },
  { prefix: 'ghr_', body: '[A-Za-z0-9]', min: 36 },
  { prefix: 'github_pat_', body: '[A-Za-z0-9_]', min: 22 },
  { prefix: 'sk-ant-', body: '[A-Za-z0-9_-]', min: 10 },
];

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PATTERNS = TOKEN_PATTERNS.map(
  (p) => new RegExp(`${escape(p.prefix)}${p.body}{${p.min},${p.max ?? ''}}${escape(p.suffix ?? '')}`, 'g'),
);
/** What a cut leaves of each pattern: the prefix and a body so far, at the end of the text. */
const UNFINISHED = TOKEN_PATTERNS.map((p) => new RegExp(`${escape(p.prefix)}${p.body}{0,${p.max ?? ''}}$`));

/** Shortest cut piece of a pattern's literal start that counts as the start of a token (shorter ones hold no secret). */
const MIN_CUT_PREFIX = 4;

/** Secret values shorter than this are not used for redaction (they would blank out ordinary text). */
export const MIN_SECRET_LENGTH = 6;

/** Every string value of a parsed JSON document, at any depth and inside arrays; other types are skipped. Iterative, so a deeply nested value cannot overflow the call stack. */
function stringLeaves(root: unknown): string[] {
  const out: string[] = [];
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) for (const n of node) stack.push(n);
    else if (node !== null && typeof node === 'object') for (const n of Object.values(node)) stack.push(n);
  }
  return out;
}

/**
 * What to mask for one secret: the value whole (a multi-line paste too), its JSON-escaped form and a copy without
 * whitespace. For a JSON object or array (a pasted credentials file: Codex auth.json, an OpenCode export) also each
 * string value inside it that is at least MIN_SECRET_LENGTH long. Text that does not parse is masked whole, and each of
 * its lines on its own, so a log line that holds only a part of a pasted value is masked too. Any failure while reading
 * the JSON falls back to masking the text whole.
 */
function computeMaskTargets(secret: string): string[] {
  const out = [secret, secret.replace(/\s+/g, '')];
  let leaves: string[] | null = null;
  try {
    const parsed: unknown = JSON.parse(secret);
    if (parsed !== null && typeof parsed === 'object') leaves = stringLeaves(parsed);
  } catch {
    // not JSON, or too deep to read: masked whole, and line by line below
  }
  if (leaves !== null) {
    for (const v of leaves) if (v.length >= MIN_SECRET_LENGTH) out.push(v);
  } else if (secret.includes('\n')) {
    for (const line of secret.split(/\r?\n/)) if (line.trim().length >= MIN_SECRET_LENGTH) out.push(line.trim());
  }
  // The same values as a JSON string body (`\n` as two characters, quotes escaped), as they appear inside logged JSON.
  for (const v of [...out]) {
    const escaped = JSON.stringify(v).slice(1, -1);
    if (escaped !== v) out.push(escaped);
  }
  return out.filter((v) => v.length > 0 && (v === secret || v.length >= MIN_SECRET_LENGTH));
}

const MASK_CACHE_MAX = 64;
/** Per-secret expansion, kept in memory only (never logged); `redact` runs per output line with the same list. */
const maskCache = new Map<string, string[]>();

function maskTargets(secret: string): string[] {
  const hit = maskCache.get(secret);
  if (hit) return hit;
  const targets = computeMaskTargets(secret);
  if (maskCache.size >= MASK_CACHE_MAX) maskCache.clear();
  maskCache.set(secret, targets);
  return targets;
}

/** How many secrets the expansion memo holds (it is bounded). */
export function maskCacheSize(): number {
  return maskCache.size;
}

/** Replaces every given secret (and the values inside a pasted credentials file) and well-known token pattern with `***`. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  const targets = [...new Set(secrets.filter((x) => x.length > 0).flatMap(maskTargets))];
  // Longest first so a secret that contains another is replaced whole.
  for (const s of targets.sort((a, b) => b.length - a.length)) {
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
