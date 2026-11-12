import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const STATE_TTL_MS = 10 * 60 * 1000;

const Payload = z.object({ orgId: z.string().min(1), userId: z.string().min(1), exp: z.number().int() });
export interface InstallState {
  orgId: string;
  userId: string;
}

const mac = (secret: string, payload: string): Buffer => createHmac('sha256', secret).update(payload).digest();

/** `<base64url payload>.<base64url HMAC-SHA256>`; the payload carries an expiry. */
export function signState(secret: string, state: InstallState, now: Date = new Date()): string {
  const payload = Buffer.from(JSON.stringify({ ...state, exp: now.getTime() + STATE_TTL_MS })).toString('base64url');
  return `${payload}.${mac(secret, payload).toString('base64url')}`;
}

/** Returns the signed identity, or null when the state is malformed, forged or expired. */
export function verifyState(secret: string, state: string, now: Date = new Date()): InstallState | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [payload = '', sig = ''] = parts;
  const given = Buffer.from(sig, 'base64url');
  const expected = mac(secret, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = Payload.safeParse(json);
  if (!parsed.success || parsed.data.exp <= now.getTime()) return null;
  return { orgId: parsed.data.orgId, userId: parsed.data.userId };
}
