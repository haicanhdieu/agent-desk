const PATTERNS = [/x-access-token:[^@\s]+@/g, /ghs_[A-Za-z0-9]{20,}/g, /sk-ant-[A-Za-z0-9_-]{10,}/g];

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
