import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const migrationsFolder = fileURLToPath(new URL('../../migrations', import.meta.url));

interface JournalEntry {
  tag: string;
}

/**
 * Applies the pending migrations up to and including `tag` (e.g. '0047_agent_configs') with the existing drizzle
 * migrator, from a temp copy of migrations/ whose journal is cut after `tag`. Already applied ones are skipped, so
 * it can be called again with a later tag to step forward one migration at a time.
 */
export async function runMigrationsUpTo(ownerUrl: string, tag: string): Promise<void> {
  const journal = JSON.parse(await readFile(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  const last = journal.entries.findIndex((e) => e.tag === tag);
  if (last < 0) throw new Error(`runMigrationsUpTo: no migration tagged ${tag}`);
  const entries = journal.entries.slice(0, last + 1);
  const tmp = await mkdtemp(path.join(tmpdir(), 'agentdesk-migrations-'));
  try {
    await mkdir(path.join(tmp, 'meta'));
    for (const e of entries) await cp(path.join(migrationsFolder, `${e.tag}.sql`), path.join(tmp, `${e.tag}.sql`));
    await writeFile(path.join(tmp, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
    const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
    try {
      await migrate(drizzle(pool), { migrationsFolder: tmp });
    } finally {
      await pool.end();
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
