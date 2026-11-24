import { ApiError, createApi } from '@agentdesk/contracts/client';
import { describe, expect, it } from 'vitest';
import { ids } from '../dto/ids';
import { scenarios } from './scenarios';

// The mock API answers like the API guard for a role without a permission (issue 216): 403 before anything is read.
// The browser mock and the route tests rely on it to show what a member or viewer would get from the real API.

const api = createApi({ baseUrl: 'http://localhost:3000', parse: true });
const params = { projectId: ids.project.invoicerApi };
const orgParams = { orgId: ids.created(777) };

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
}

const deskReads = () => [
  api.agents.get({ params }),
  api.agents.models({ params: { agentId: ids.agent.invoicerApi } }),
  api.setupScript.get({ params }),
  api.setup.plugins({ params }),
  api.setupTests.latest({ params }),
  api.skills.list({ params, query: { page: 1, pageSize: 20 } }),
  api.rules.list({ params, query: { page: 1, pageSize: 20 } }),
  api.rules.promptPreview({ params }),
];

describe('the mock API guard', () => {
  it.each(['member', 'viewer'] as const)(
    'answers 403 to a %s on every Desk read and on the roles list',
    async (seat) => {
      scenarios.onboarding(seat);
      for (const call of deskReads()) expect(await status(call)).toBe(403);
      expect(await status(api.roles.list({ params: orgParams }))).toBe(403);
    },
  );

  it.each(['member', 'viewer'] as const)('still lets a %s read projects and runs', async (seat) => {
    scenarios.onboarding(seat);
    expect(await status(api.projects.get({ params }))).toBe(200);
    expect(await status(api.runs.list({ params, query: { page: 1, pageSize: 20 } }))).toBe(200);
  });

  it.each(['owner', 'orgAdmin'] as const)('lets an %s read the Desk', async (seat) => {
    scenarios.onboarding(seat);
    for (const call of deskReads()) expect(await status(call)).toBe(200);
  });
});

const envWrites = (): (() => Promise<unknown>)[] => [
  () => api.projectEnv.createVar({ params, body: { name: 'NEW_ONE', value: 'x' } }),
  () => api.projectEnv.updateVar({ params: { ...params, name: 'DB_HOST' }, body: { value: 'x' } }),
  () => api.projectEnv.removeVar({ params: { ...params, name: 'DB_HOST' } }),
  () => api.projectEnv.createSecret({ params, body: { name: 'NEW_SECRET', value: 'test-token-not-real-1' } }),
  () =>
    api.projectEnv.updateSecret({ params: { ...params, name: 'NPM_TOKEN' }, body: { value: 'test-token-not-real-2' } }),
  () => api.projectEnv.removeSecret({ params: { ...params, name: 'NPM_TOKEN' } }),
];
const envList = (kind: 'plain' | 'secret') => api.projectEnv.list({ params, query: { kind, page: 1, pageSize: 20 } });

describe('the mock API guard on the project environment routes', () => {
  it.each(['member', 'viewer'] as const)('answers 403 to a %s on all 7 routes', async (seat) => {
    scenarios.onboarding(seat);
    expect(await status(envList('plain'))).toBe(403);
    expect(await status(envList('secret'))).toBe(403);
    for (const call of envWrites()) expect(await status(call())).toBe(403);
  });

  it('lets the setup-reader role list both kinds and answers 403 to the 6 writes', async () => {
    scenarios.onboarding('setupReader');
    expect(await status(envList('plain'))).toBe(200);
    expect(await status(envList('secret'))).toBe(200);
    for (const call of envWrites()) expect(await status(call())).toBe(403);
    // Nothing changed.
    expect((await envList('plain')).total).toBe(3);
    expect((await envList('secret')).total).toBe(2);
  });

  it.each(['owner', 'orgAdmin'] as const)('lets an %s list and change entries', async (seat) => {
    scenarios.onboarding(seat);
    expect(await status(envList('plain'))).toBe(200);
    for (const call of envWrites()) expect(await status(call())).toBe(200);
  });
});
