import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/client';
import { seedPlatformAdmin } from '../src/platform-admins';
import { startPg, type TestPg } from './helpers/pg';

// BR-28 integration and N-5: the seed function, run as the app role, adds one lowercased entry and is idempotent.

let env: TestPg;
let db: Db;

const rows = async () =>
  (
    await db.pool.query<{ email: string; granted_by: string | null; granted_at: Date | null }>(
      'select email, granted_by, granted_at from platform_admins order by email',
    )
  ).rows;

beforeAll(async () => {
  env = await startPg();
  db = createDb(env.appUrl);
}, 180_000);

afterAll(async () => {
  await db?.close();
  await env?.stop();
});

describe('seedPlatformAdmin', () => {
  it('adds the trimmed, lowercased email with no granter', async () => {
    await seedPlatformAdmin(db, '  Ops@Example.COM ');
    const found = await rows();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ email: 'ops@example.com', granted_by: null });
    expect(found[0]?.granted_at).toBeInstanceOf(Date);
  });

  it('a second call for the same email resolves and leaves one row', async () => {
    await seedPlatformAdmin(db, 'ops@example.com');
    await expect(seedPlatformAdmin(db, ' OPS@example.com')).resolves.toBeUndefined();
    expect(await rows()).toHaveLength(1);
  });

  it('rejects a blank email and adds no row', async () => {
    await expect(seedPlatformAdmin(db, '   ')).rejects.toThrow();
    expect(await rows()).toHaveLength(1);
  });
});
