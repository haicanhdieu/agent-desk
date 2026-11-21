import type { CreateOrgResponse } from '@agentdesk/contracts';
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

/** Dev-logs in `admin` (admin@dev.local, a platform admin in the default test env) and returns the session cookie. */
export async function asPlatformAdmin(t: TestApp): Promise<string> {
  return loginAs(t, 'admin');
}

/** Creates an org through the platform route as the platform admin; throws unless it answers 201. */
export async function createOrg(t: TestApp, name: string, slug: string): Promise<CreateOrgResponse> {
  const cookie = await asPlatformAdmin(t);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/platform/orgs',
    headers: { cookie },
    payload: { name, slug },
  });
  if (res.statusCode !== 201) throw new Error(`createOrg ${slug} answered ${res.statusCode}: ${res.body}`);
  return res.json<CreateOrgResponse>();
}
