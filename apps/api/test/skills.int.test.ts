import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page, SkillDto, SkillSummaryDto } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let alice: string;
let bob: string;
let projectId: string;
let aliceOrgId: string;

beforeAll(async () => {
  t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
  const aliceOrg = (await createOrg(t, 'Alice', 'alice')).id;
  aliceOrgId = aliceOrg;
  const bobOrg = (await createOrg(t, 'Bob', 'bob')).id;
  alice = await inviteAndLogin(t, aliceOrg, 'alice', 'owner', { type: 'org' });
  bob = await inviteAndLogin(t, bobOrg, 'bob', 'owner', { type: 'org' });
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
    ) as Page<SkillSummaryDto>;
    expect(list.items.map((s) => s.name)).toContain('fix');
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

  describe('paging', () => {
    const names = Array.from({ length: 22 }, (_, i) => `page-skill-${String.fromCharCode(97 + i)}`);
    let pagedProject: string;
    const listPage = (query: string, cookie = alice) =>
      t.app.inject({ method: 'GET', url: `/api/projects/${pagedProject}/skills${query}`, headers: { cookie } });

    beforeAll(async () => {
      pagedProject = (await makeProject(t, alice, await installFake(t, alice))).projectId;
      // Shuffled insert order (every 7th name, 22 and 7 share no factor): the list must still come back A to Z.
      for (let i = 0; i < names.length; i++) {
        const name = names[(i * 7) % names.length];
        const res = await t.app.inject({
          method: 'PUT',
          url: `/api/projects/${pagedProject}/skills/${name}`,
          headers: { cookie: alice },
          payload: { body: `body of ${name}`, message: 'seed' },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('page 1 holds the first 20 names A to Z, page 2 the last 2', async () => {
      const first = expectContract('skills.list', await listPage('?page=1&pageSize=20')) as Page<SkillSummaryDto>;
      expect(first.items.map((s) => s.name)).toEqual(names.slice(0, 20));
      expect(first.total).toBe(22);
      const second = expectContract('skills.list', await listPage('?page=2&pageSize=20')) as Page<SkillSummaryDto>;
      expect(second.items.map((s) => s.name)).toEqual(names.slice(20));
      expect(second.total).toBe(22);
    });

    it('a page past the end is empty with the real total', async () => {
      const res = expectContract('skills.list', await listPage('?page=3&pageSize=20')) as Page<SkillSummaryDto>;
      expect(res.items).toEqual([]);
      expect(res.total).toBe(22);
    });

    it('out-of-range paging is a 400', async () => {
      expect((await listPage('?page=0')).statusCode).toBe(400);
      expect((await listPage('?pageSize=101')).statusCode).toBe(400);
    });

    it("another org's project is a 404", async () => {
      expect((await listPage('?page=1&pageSize=20', bob)).statusCode).toBe(404);
    });
  });

  it('another org gets 404 on every route', async () => {
    expect((await get('fix', bob)).statusCode).toBe(404);
    expect((await put('fix', { body: 'x', message: 'm' }, bob)).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: url(), headers: { cookie: bob } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: url('fix'), headers: { cookie: bob } })).statusCode).toBe(404);
  });
});

describe('skills: permission (BR-33, BR-29)', () => {
  const del = (name: string, cookie: string) => t.app.inject({ method: 'DELETE', url: url(name), headers: { cookie } });

  it('TC-33.6: a member cannot put or remove a skill; it is unchanged on reread', async () => {
    expect((await put('guarded', { body: 'original', message: 'seed' })).statusCode).toBe(200);
    const before = (await get('guarded').then((r) => r.json())) as SkillDto;
    const member = await inviteAndLogin(t, aliceOrgId, 'skills-member', 'member', { type: 'org' });

    expect((await put('guarded', { body: 'changed', message: 'm', sha: before.sha }, member)).statusCode).toBe(403);
    expect((await put('member-made', { body: 'x', message: 'm' }, member)).statusCode).toBe(403);
    expect((await del('guarded', member)).statusCode).toBe(403);

    expect((await get('guarded').then((r) => r.json())) as SkillDto).toEqual(before);
    expect((await get('member-made')).statusCode).toBe(404);
    // A member has no Desk read either (issue 216).
    expect((await get('guarded', member)).statusCode).toBe(403);
  });

  it('TC-29.2: an admin on P1 only can put a skill on P1', async () => {
    const admin = await inviteAndLogin(t, aliceOrgId, 'skills-admin', 'admin', {
      type: 'project',
      projectIds: [projectId],
    });
    const res = await put('admin-made', { body: 'by admin', message: 'm' }, admin);
    expect(res.statusCode).toBe(200);
    expectContract('skills.put', res);
    expect(((await get('admin-made').then((r) => r.json())) as SkillDto).body).toBe('by admin');
  });

  it('TC-29.2: an admin on P1 only gets 404 putting a skill on another project and nothing is created', async () => {
    const other = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const admin = await inviteAndLogin(t, aliceOrgId, 'skills-admin-out', 'admin', {
      type: 'project',
      projectIds: [projectId],
    });
    const otherUrl = `/api/projects/${other}/skills/admin-out`;
    const res = await t.app.inject({
      method: 'PUT',
      url: otherUrl,
      headers: { cookie: admin },
      payload: { body: 'x', message: 'm' },
    });
    expect(res.statusCode).toBe(404);
    const reread = await t.app.inject({ method: 'GET', url: otherUrl, headers: { cookie: alice } });
    expect(reread.statusCode).toBe(404);
  });
});
