const SECRET_KEY = /token|secret|password|credential|authorization|api[-_]?key|private[-_]?key/i;

function isDropped(key: string): boolean {
  return key.toLowerCase() === 'value' || SECRET_KEY.test(key);
}

/** Copy of a request body without secret-bearing keys, at any depth. Non-object input yields `{}`. */
export function redactBody(body: unknown): Record<string, unknown> {
  const out = redact(body);
  return isRecord(out) ? out : {};
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (isRecord(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (!isDropped(k)) out[k] = redact(val);
    }
    return out;
  }
  return v;
}
