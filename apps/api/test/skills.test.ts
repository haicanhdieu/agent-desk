import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SkillDto, SkillSummaryDto } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let alice: string;
let bob: string;
let projectId: string;

beforeAll(async () => {
  t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
  alice = await loginAs(t, 'alice');
  bob = await loginAs(t, 'bob');
  projectId = (await makeProject(t, alice, await installFake(t, alice))).projectId;
});
afterAll(async () => {
  await t.close();
});

const url = (name = '') => `/api/projects/${projectId}/skills${name ? `/${name}` : ''}`;
const put = (name: string, payload: object, cookie = alice) =>
  t.app.inject({ method: 'PUT', url: url(name), headers: { cookie }, payload });
const get = (name: string, cookie = alice) => t.app.inject({ method: 'GET', url: url(name), headers: { cookie } });

describe('skills', () => {
  it('puts then gets a skill with a new sha; lists it', async () => {
    const body = '---\ndescription: Fix bugs\n---\nDo it.\n';
    const w = await put('fix', { body, message: 'add fix' });
    expect(w.statusCode).toBe(200);
    expectContract('skills.put', w);
    const g = expectContract('skills.get', await get('fix')) as SkillDto;
    expect(g.body).toBe(body);
    expect(g.sha).toEqual(expect.any(String));
    expect(g.description).toBe('Fix bugs');

    const w2 = await put('fix', { body: body + 'more\n', message: 'edit', sha: g.sha });
    expect(w2.statusCode).toBe(200);
    const g2 = (await get('fix').then((r) => r.json())) as SkillDto;
    expect(g2.sha).not.toBe(g.sha);
    expect(g2.body).toContain('more');

    const list = expectContract(
      'skills.list',
      await t.app.inject({ method: 'GET', url: url(), headers: { cookie: alice } }),
    ) as SkillSummaryDto[];
    expect(list.map((s) => s.name)).toContain('fix');
  });

  it('PUT with a stale sha is a 409 problem', async () => {
    await put('stale', { body: 'one', message: 'm' });
    const first = (await get('stale').then((r) => r.json())) as SkillDto;
    await put('stale', { body: 'two', message: 'm', sha: first.sha });
    const res = await put('stale', { body: 'three', message: 'm', sha: first.sha });
    expect(res.statusCode).toBe(409);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(((await get('stale').then((r) => r.json())) as SkillDto).body).toBe('two');
  });

  it('PUT creating without sha over an existing skill is a 409', async () => {
    await put('twice', { body: 'a', message: 'm' });
    expect((await put('twice', { body: 'b', message: 'm' })).statusCode).toBe(409);
  });

  it('GET unknown is 404; invalid name is 400', async () => {
    expect((await get('missing')).statusCode).toBe(404);
    expect((await get('Bad_Name')).statusCode).toBe(400);
  });

  it('DELETE removes with or without a message; unknown is 404', async () => {
    await put('gone', { body: 'x', message: 'm' });
    const del = await t.app.inject({ method: 'DELETE', url: url('gone'), headers: { cookie: alice } });
    expect(del.statusCode).toBe(204);
    expect((await get('gone')).statusCode).toBe(404);
    await put('gone2', { body: 'x', message: 'm' });
    const del2 = await t.app.inject({
      method: 'DELETE',
      url: `${url('gone2')}?message=bye`,
      headers: { cookie: alice },
    });
    expect(del2.statusCode).toBe(204);
    const del3 = await t.app.inject({ method: 'DELETE', url: url('gone2'), headers: { cookie: alice } });
    expect(del3.statusCode).toBe(404);
  });

  it('another org gets 404 on every route', async () => {
    expect((await get('fix', bob)).statusCode).toBe(404);
    expect((await put('fix', { body: 'x', message: 'm' }, bob)).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: url(), headers: { cookie: bob } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: url('fix'), headers: { cookie: bob } })).statusCode).toBe(404);
  });
});
