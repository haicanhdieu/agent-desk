import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApplicationFailure } from '@temporalio/common';
import { MemorySecretStore, projectEnvSecretName, type SecretStore } from '@agentdesk/core';
import { createDb, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { PROJECT_ENV_READ_CONCURRENCY, loadProjectEnv } from '../src/activities/project-env';

const ORG_A = '77777777-7777-4777-8777-777777777771';
const ORG_B = '77777777-7777-4777-8777-777777777772';

let pgx: TestPg;
let db: Db;
const conn: Record<string, string> = {};

/** MemorySecretStore that records reads and concurrency; a gate can hold reads in flight. */
class SpyStore extends MemorySecretStore {
  reads: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  gate: Promise<void> | null = null;
  failWith: Error | null = null;
  override async get(name: string): Promise<Record<string, string> | null> {
    this.reads.push(name);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.gate) await this.gate;
      if (this.failWith) throw this.failWith;
      return await super.get(name);
    } finally {
      this.inFlight--;
    }
  }
}

async function owner<T>(orgId: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: pgx.ownerUrl });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [orgId]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } finally {
    await c.end();
  }
}

async function seedProject(orgId: string): Promise<string> {
  return owner(orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id)
       values ($1, $2, $4, $3, $3) returning id`,
      [orgId, `p-${Math.random()}`, conn[orgId], `dev/demo-${Math.random()}`],
    );
    return r.rows[0]?.id ?? '';
  });
}

async function addEntry(
  orgId: string,
  projectId: string,
  name: string,
  kind: 'plain' | 'secret',
  value: string | null,
): Promise<string> {
  return owner(orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into project_env_vars (org_id, project_id, name, kind, value, size_bytes, updated_by)
       values ($1, $2, $3, $4, $5, 1, 'u') returning id`,
      [orgId, projectId, name, kind, value],
    );
    return r.rows[0]?.id ?? '';
  });
}

async function addSecret(store: SecretStore, orgId: string, projectId: string, name: string, value: string) {
  const id = await addEntry(orgId, projectId, name, 'secret', null);
  await store.put(projectEnvSecretName(orgId, id), { value });
  return id;
}

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  for (const org of [ORG_A, ORG_B]) {
    await owner(org, async (c) => {
      await c.query(`insert into organization (id, name, slug, created_at) values ($1, $2, $2, now())`, [
        org,
        `o-${org.slice(-1)}`,
      ]);
      const r = await c.query<{ id: string }>(
        `insert into connections (org_id, provider, capabilities, external_id, account_name)
         values ($1, 'fake', '{"code":true,"board":true}', $2, 'dev') returning id`,
        [org, `fake-${org}`],
      );
      conn[org] = r.rows[0]?.id ?? '';
    });
  }
});

afterAll(async () => {
  await pgx.stop();
});

describe('loadProjectEnv', () => {
  it('returns an empty result for a project without entries', async () => {
    const p = await seedProject(ORG_A);
    expect(await loadProjectEnv(db, new SpyStore(), { orgId: ORG_A, projectId: p })).toEqual({
      plain: [],
      secrets: {},
    });
  });

  it('returns plain values verbatim and secret values by name', async () => {
    const p = await seedProject(ORG_A);
    const store = new SpyStore();
    await addEntry(ORG_A, p, 'SPACED', 'plain', '  a b  ');
    await addEntry(ORG_A, p, 'EMPTY', 'plain', '');
    await addSecret(store, ORG_A, p, 'TOKEN', 's3cr3t value ');
    const out = await loadProjectEnv(db, store, { orgId: ORG_A, projectId: p });
    expect([...out.plain].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'EMPTY', value: '' },
      { name: 'SPACED', value: '  a b  ' },
    ]);
    expect(out.secrets).toEqual({ TOKEN: 's3cr3t value ' });
  });

  it('keeps secrets named like Object.prototype members as own keys', async () => {
    const p = await seedProject(ORG_A);
    const store = new SpyStore();
    for (const name of ['__proto__', 'toString', 'constructor', 'valueOf']) {
      await addSecret(store, ORG_A, p, name, `v-${name}`);
    }
    const out = await loadProjectEnv(db, store, { orgId: ORG_A, projectId: p });
    expect(Object.keys(out.secrets).sort()).toEqual(['__proto__', 'constructor', 'toString', 'valueOf']);
    expect(Object.hasOwn(out.secrets, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(out.secrets, '__proto__')?.value).toBe('v-__proto__');
    expect(Object.getPrototypeOf(out.secrets)).toBe(Object.prototype);
  });

  it('reads at most the concurrency limit of secrets at once', async () => {
    const p = await seedProject(ORG_A);
    const store = new SpyStore();
    for (let i = 0; i < 25; i++) await addSecret(store, ORG_A, p, `S_${i}`, `v${i}`);
    let release: () => void = () => {};
    store.gate = new Promise<void>((r) => (release = r));
    const pending = loadProjectEnv(db, store, { orgId: ORG_A, projectId: p });
    await expect.poll(() => store.inFlight).toBe(PROJECT_ENV_READ_CONCURRENCY);
    release();
    const out = await pending;
    expect(Object.keys(out.secrets)).toHaveLength(25);
    expect(store.maxInFlight).toBe(PROJECT_ENV_READ_CONCURRENCY);
    expect(store.reads).toHaveLength(25);
  });

  it('never reads an orphan Secret, another project, or another org', async () => {
    const p = await seedProject(ORG_A);
    const other = await seedProject(ORG_A);
    const otherOrg = await seedProject(ORG_B);
    const store = new SpyStore();
    const mine = await addSecret(store, ORG_A, p, 'MINE', 'm');
    const sibling = await addSecret(store, ORG_A, other, 'SIBLING', 'x');
    const foreign = await addSecret(store, ORG_B, otherOrg, 'FOREIGN', 'y');
    await store.put(projectEnvSecretName(ORG_A, '00000000-0000-4000-8000-000000000000'), { value: 'orphan' });
    const out = await loadProjectEnv(db, store, { orgId: ORG_A, projectId: p });
    expect(out.secrets).toEqual({ MINE: 'm' });
    expect(store.reads).toEqual([projectEnvSecretName(ORG_A, mine)]);
    expect(store.reads).not.toContain(projectEnvSecretName(ORG_A, sibling));
    expect(store.reads).not.toContain(projectEnvSecretName(ORG_B, foreign));
  });

  it('does not return another org rows even with that org project id', async () => {
    const otherOrg = await seedProject(ORG_B);
    await addEntry(ORG_B, otherOrg, 'B_PLAIN', 'plain', 'b');
    const out = await loadProjectEnv(db, new SpyStore(), { orgId: ORG_A, projectId: otherOrg });
    expect(out).toEqual({ plain: [], secrets: {} });
  });

  it('fails non-retryably naming only the variable when the Secret is missing', async () => {
    const p = await seedProject(ORG_A);
    const store = new SpyStore();
    await addEntry(ORG_A, p, 'GONE', 'secret', null);
    const err = await loadProjectEnv(db, store, { orgId: ORG_A, projectId: p }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect((err as ApplicationFailure).message).toContain('GONE');
  });

  it('fails non-retryably when the Secret has no value key', async () => {
    const p = await seedProject(ORG_A);
    const store = new SpyStore();
    const id = await addEntry(ORG_A, p, 'NOKEY', 'secret', null);
    await store.put(projectEnvSecretName(ORG_A, id), { other: 'leaky-value' });
    const err = await loadProjectEnv(db, store, { orgId: ORG_A, projectId: p }).catch((e: unknown) => e);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect((err as ApplicationFailure).message).toContain('NOKEY');
    expect((err as ApplicationFailure).message).not.toContain('leaky-value');
  });

  it('fails retryably with no value in the message on a store read error', async () => {
    const p = await seedProject(ORG_A);
    const store = new SpyStore();
    await addSecret(store, ORG_A, p, 'TOKEN', 'topsecret');
    store.failWith = new Error('boom topsecret');
    const err = await loadProjectEnv(db, store, { orgId: ORG_A, projectId: p }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { nonRetryable?: boolean }).nonRetryable).not.toBe(true);
    expect((err as Error).message).not.toContain('topsecret');
  });
});
