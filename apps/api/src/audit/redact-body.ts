import { createHash } from 'node:crypto';

const SECRET_KEY = /token|secret|password|credential|authorization|api[-_]?key|private[-_]?key/i;

function isDropped(key: string): boolean {
  return key.toLowerCase() === 'value' || SECRET_KEY.test(key);
}

/**
 * Audit actions whose request body carries user script text, mapped to that top-level field. The text is never audited:
 * it is replaced by `{ sha256, bytes }`. A new route with script text only needs its key here.
 */
export const SCRIPT_FIELD_BY_ACTION: Record<string, string> = {
  'PUT setupScript.put': 'body',
  'POST setupTests.create': 'script',
};

/**
 * Copy of a request body without secret-bearing keys, at any depth. Non-object input yields `{}`.
 * For actions in `SCRIPT_FIELD_BY_ACTION` the script field becomes `{ sha256, bytes }` (dropped if not a string).
 */
export function redactBody(body: unknown, action?: string): Record<string, unknown> {
  const out = redact(body);
  if (!isRecord(out)) return {};
  const field = action === undefined ? undefined : SCRIPT_FIELD_BY_ACTION[action];
  if (field === undefined || !isRecord(body) || !(field in body)) return out;
  delete out[field];
  const text = body[field];
  if (typeof text === 'string') {
    out['sha256'] = createHash('sha256').update(text, 'utf8').digest('hex');
    out['bytes'] = Buffer.byteLength(text, 'utf8');
  }
  return out;
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
