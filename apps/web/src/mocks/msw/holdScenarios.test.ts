import { ORG_HEADER, ProblemSchema } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { ids } from '../dto/ids';
import { HELD_READS, HOLD_KEY, holdHandlers, parseHoldConfig, type HeldRead } from './holdScenarios';
import { server } from './node';

const BASE = 'http://localhost:3000';
const ORG = ids.org.alice;
const PROJECT = ids.project.invoicerApi;

/** One request per held read; each is answered by the mock API when nothing holds it. */
const requests: Record<HeldRead, { path: string; headers?: Record<string, string> }> = {
  orgList: { path: '/auth/organization/list' },
  projectList: { path: '/api/projects', headers: { [ORG_HEADER]: ORG } },
  projectDetail: { path: `/api/projects/${PROJECT}`, headers: { [ORG_HEADER]: ORG } },
  orgAccess: { path: '/api/me/access', headers: { [ORG_HEADER]: ORG } },
  sessionAccess: { path: '/api/me/access' },
  platformAdmin: { path: '/api/me/platform' },
  platformOrg: { path: `/api/platform/orgs/${ORG}` },
  members: { path: `/api/orgs/${ORG}/members`, headers: { [ORG_HEADER]: ORG } },
  projectRuns: { path: `/api/projects/${PROJECT}/runs`, headers: { [ORG_HEADER]: ORG } },
  rules: { path: `/api/projects/${PROJECT}/rules`, headers: { [ORG_HEADER]: ORG } },
  invitation: { path: `/api/me/invitations/${ids.org.alice}` },
  myInvitations: { path: '/api/me/invitations' },
};

const get = (read: HeldRead, signal?: AbortSignal) => {
  const { path, headers } = requests[read];
  return fetch(`${BASE}${path}`, { ...(headers && { headers }), ...(signal && { signal }) });
};

/** Whether the promise is still pending after the given time (the mock answers in well under that). */
async function settlesWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  const pending = Symbol('pending');
  const winner = await Promise.race([p.then(() => 'settled'), new Promise((r) => setTimeout(() => r(pending), ms))]);
  return winner !== pending;
}

const hold = (config: Parameters<typeof holdHandlers>[0]) => {
  const held = holdHandlers(config);
  server.use(...held.handlers);
  return held;
};

describe('holdHandlers', () => {
  it('holds a read until it is released, then the mock API answers it', async () => {
    const held = hold({ projectList: 'hold' });
    const res = get('projectList');
    expect(await settlesWithin(res, 60)).toBe(false);
    held.release('projectList');
    const answered = await res;
    expect(answered.status).toBe(200);
    expect(await answered.json()).toMatchObject({ items: expect.any(Array) as unknown });
  });

  it('release(read, "fail") answers the held read 500 problem+json, and the reads after it', async () => {
    const held = hold({ orgList: 'hold' });
    const res = get('orgList');
    held.release('orgList', 'fail');
    const answered = await res;
    expect(answered.status).toBe(500);
    expect(answered.headers.get('content-type')).toContain('application/problem+json');
    expect(ProblemSchema.safeParse(await answered.json()).success).toBe(true);
    // The app retries a 5xx on its own: the error state needs the next read to fail as well.
    expect((await get('orgList')).status).toBe(500);
  });

  it('only holds the read it names', async () => {
    hold({ projectList: 'hold' });
    expect((await get('myInvitations')).status).toBe(200);
  });

  it('failOnce fails the first request and passes the next through', async () => {
    hold({ projectList: 'failOnce' });
    expect((await get('projectList')).status).toBe(500);
    expect((await get('projectList')).status).toBe(200);
    expect((await get('projectList')).status).toBe(200);
  });

  it('fail answers 500 every time', async () => {
    hold({ rules: 'fail' });
    expect((await get('rules')).status).toBe(500);
    expect((await get('rules')).status).toBe(500);
  });

  it('pending never answers', async () => {
    hold({ members: 'pending' });
    const controller = new AbortController();
    const res = get('members', controller.signal);
    expect(
      await settlesWithin(
        res.catch(() => undefined),
        80,
      ),
    ).toBe(false);
    controller.abort();
    await expect(res).rejects.toThrow();
  });

  it('notFound answers 404 and crash answers 422 with a request id', async () => {
    hold({ projectDetail: 'notFound', projectRuns: 'crash' });
    const missing = await get('projectDetail');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/problem+json');
    const crashed = await get('projectRuns');
    expect(crashed.status).toBe(422);
    const body = ProblemSchema.parse(await crashed.json());
    expect(body.requestId).toMatch(/\S/);
    expect(crashed.headers.get('x-request-id')).toBe(body.requestId);
  });

  it('setRead changes the next answer while the app runs, and undefined lets the read through', async () => {
    const held = hold({ projectList: 'notFound' });
    expect((await get('projectList')).status).toBe(404);
    held.setRead('projectList', 'fail');
    expect((await get('projectList')).status).toBe(500);
    held.setRead('projectList', undefined);
    expect((await get('projectList')).status).toBe(200);
    held.setRead('projectList', 'hold');
    const res = get('projectList');
    expect(await settlesWithin(res, 60)).toBe(false);
    held.release('projectList');
    expect((await res).status).toBe(200);
  });

  it('setRead lets a request already waiting on the old hold go on', async () => {
    const held = hold({ projectList: 'hold' });
    const waiting = get('projectList');
    expect(await settlesWithin(waiting, 60)).toBe(false);
    held.setRead('projectList', 'hold');
    expect(await settlesWithin(waiting, 500)).toBe(true);
    expect((await waiting).status).toBe(200);
    const next = get('projectList');
    expect(await settlesWithin(next, 60)).toBe(false);
    held.release('projectList');
    expect((await next).status).toBe(200);
  });

  it('setRead on a read that was not configured works too', async () => {
    const held = hold({});
    held.setRead('platformAdmin', 'notFound');
    expect((await get('platformAdmin')).status).toBe(404);
  });

  it('tells the org-pinned access read from the session one by the org header', async () => {
    hold({ orgAccess: 'notFound' });
    expect((await get('orgAccess')).status).toBe(404);
    expect((await get('sessionAccess')).status).toBe(200);
    hold({ sessionAccess: 'fail' });
    expect((await get('sessionAccess')).status).toBe(500);
    expect((await get('orgAccess')).status).toBe(404);
  });

  it.each(HELD_READS)('%s: reaches its read, and unsetting it gives back the mock answer', async (read) => {
    const open = await get(read);
    const held = hold({ [read]: 'fail' });
    expect((await get(read)).status).toBe(500);
    held.setRead(read, undefined);
    expect((await get(read)).status).toBe(open.status);
  });
});

describe('parseHoldConfig', () => {
  it('reads a stored config, and ignores anything unparsable or unknown', () => {
    expect(HOLD_KEY).toBe('agentdesk.mock.hold');
    expect(parseHoldConfig(JSON.stringify({ orgList: 'hold', rules: 'crash' }))).toEqual({
      orgList: 'hold',
      rules: 'crash',
    });
    expect(parseHoldConfig(null)).toBeUndefined();
    expect(parseHoldConfig('{')).toBeUndefined();
    expect(parseHoldConfig(JSON.stringify({ orgList: 'sleep' }))).toBeUndefined();
    expect(parseHoldConfig(JSON.stringify({ nothing: 'hold' }))).toBeUndefined();
  });
});
