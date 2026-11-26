import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_KIND_CAPABILITIES } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin } from './helpers/auth';
import { makeAgent } from './helpers/agents';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let owner: string;
let projectId: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
  const org = await createOrg(t, 'Addr Org', 'addr-org');
  owner = await inviteAndLogin(t, org.id, 'addr-owner', 'owner', { type: 'org' });
  projectId = (await makeProject(t, owner, await installFake(t, owner))).projectId;
  ids['claude'] = (await makeAgent(t, owner, projectId, { provider: 'claude', name: 'Addr claude' })).id;
  ids['opencode'] = (await makeAgent(t, owner, projectId, { provider: 'opencode', name: 'Addr opencode' })).id;
});
afterAll(async () => {
  await t.close();
});

const putCred = (agentId: string, payload: object) =>
  t.app.inject({ method: 'PUT', url: `/api/agents/${agentId}/credential`, headers: { cookie: owner }, payload });

// The kinds whose capability row has an address, each with the credential type that takes it.
const ADDRESS_KINDS = ['claude', 'opencode'] as const;
const BAD_ADDRESSES: [string, string][] = [
  ['http scheme', 'http://llm.example.com/v1'],
  ['file scheme', 'file:///etc/passwd'],
  ['javascript scheme', 'javascript:alert(1)'],
  ['private host', 'https://10.0.0.5/v1'],
  ['link-local host', 'https://169.254.169.254/v1'],
  ['embedded credentials', 'https://user:pass@llm.example.com/v1'],
  ['over 2048 characters', `https://llm.example.com/${'a'.repeat(2048)}`],
];

describe('AgentBaseUrl on the credential route', () => {
  it.each(ADDRESS_KINDS.flatMap((kind) => BAD_ADDRESSES.map(([label, url]) => [kind, label, url] as const)))(
    '%s: %s is 400 on /baseUrl and stores nothing',
    async (kind, _label, baseUrl) => {
      const before = t.secrets.names().length;
      const res = await putCred(ids[kind] as string, { type: 'api_key', value: 'sk-addr-secret-1', baseUrl });
      expect(res.statusCode).toBe(400);
      const pointers = ((res.json() as { errors?: { pointer: string }[] }).errors ?? []).map((e) => e.pointer);
      expect(pointers).toContain('/baseUrl');
      expect(res.body).not.toContain('sk-addr-secret-1');
      expect(t.secrets.names()).toHaveLength(before);
    },
  );
});

describe('the capability row', () => {
  it('only Claude (optional) and OpenCode (required with api_key) have an address; Codex refuses it on both types', async () => {
    const withAddress = Object.entries(AGENT_KIND_CAPABILITIES)
      .filter(([, cap]) => cap.baseUrl !== null)
      .map(([kind]) => kind)
      .sort();
    expect(withAddress).toEqual(['claude', 'opencode']);
    expect(AGENT_KIND_CAPABILITIES.claude.baseUrl?.requiredFor).toEqual([]);
    expect(AGENT_KIND_CAPABILITIES.opencode.baseUrl?.requiredFor).toEqual(['api_key']);
    const codex = (await makeAgent(t, owner, projectId, { provider: 'codex', name: 'Addr codex' })).id;
    for (const [type, value] of [
      ['api_key', 'sk-addr-codex'],
      ['auth_json', '{"a":1}'],
    ] as const) {
      const res = await putCred(codex, { type, value, baseUrl: 'https://llm.example.com/v1' });
      expect(res.statusCode, type).toBe(422);
    }
  });
});
