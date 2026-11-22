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
