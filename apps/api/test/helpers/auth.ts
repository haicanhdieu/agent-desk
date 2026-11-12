import type { TestApp } from './app';

export function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}

/** Dev-logs in `handle` (creating user + personal org) and returns the session cookie header value. */
export async function loginAs(t: TestApp, handle: string): Promise<string> {
  const res = await t.app.inject({ method: 'GET', url: `/auth/dev-login?handle=${encodeURIComponent(handle)}` });
  return cookieOf(res);
}
