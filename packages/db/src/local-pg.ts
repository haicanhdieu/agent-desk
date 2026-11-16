import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';

/**
 * Test-only: a throwaway Postgres server from local binaries, used by `startPg()` when TEST_PG_MODE=local.
 * Each call gets its own data directory and free loopback port, so parallel test processes never share
 * cluster-global roles. The admin password is a fixed test value; the server listens on 127.0.0.1 only.
 */
export const LOCAL_PG_ADMIN = { user: 'postgres', password: 'local-admin-pw' } as const;

export interface LocalPgServer {
  adminUrl: string;
  stop: () => Promise<void>;
}

export interface LocalPgOptions {
  binDir?: string | undefined;
  dataRoot?: string | undefined;
  /** Readiness check; defaults to opening a connection as the admin. Test seam. */
  probe?: (adminUrl: string) => Promise<boolean>;
  readyTimeoutMs?: number;
  /** Start attempts; a new port is picked each time (another process may take the free port first). */
  attempts?: number;
}

const OUTPUT_TAIL = 4_000;

export function pgBinary(binDir: string | undefined, name: 'initdb' | 'postgres'): string {
  return binDir === undefined ? name : path.join(binDir, name);
}

export function postgresArgs(dataDir: string, socketDir: string, port: number): string[] {
  return [
    '-D',
    dataDir,
    '-p',
    String(port),
    '-k',
    socketDir,
    '-h',
    '127.0.0.1',
    // Throwaway test data: durability buys nothing and costs seconds per migration run.
    '-c',
    'fsync=off',
    '-c',
    'synchronous_commit=off',
    '-c',
    'full_page_writes=off',
  ];
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error('could not pick a free port'))));
    });
  });
}

async function canConnect(adminUrl: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Runs a binary to completion; rejects with the tail of its output on a non-zero exit. */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = (b: Buffer): void => {
      out = (out + b.toString()).slice(-OUTPUT_TAIL);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}: ${out.trim()}`)),
    );
  });
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const kill = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.once('exit', () => {
      clearTimeout(kill);
      resolve();
    });
    // SIGINT = "fast" shutdown: roll back open transactions and close client connections.
    child.kill('SIGINT');
  });
}

async function startServer(
  binDir: string | undefined,
  runDir: string,
  probe: (adminUrl: string) => Promise<boolean>,
  readyTimeoutMs: number,
): Promise<{ child: ChildProcess; adminUrl: string }> {
  const port = await freePort();
  const adminUrl = `postgres://${LOCAL_PG_ADMIN.user}:${LOCAL_PG_ADMIN.password}@127.0.0.1:${port}/postgres`;
  const child = spawn(pgBinary(binDir, 'postgres'), postgresArgs(path.join(runDir, 'data'), runDir, port), {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let out = '';
  child.stderr?.on('data', (b: Buffer) => {
    out = (out + b.toString()).slice(-OUTPUT_TAIL);
  });
  let spawnError: Error | undefined;
  child.once('error', (e) => (spawnError = e));

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`postgres exited before it was ready: ${out.trim()}`);
    }
    if (await probe(adminUrl)) return { child, adminUrl };
    await new Promise((r) => setTimeout(r, 100));
  }
  await stopChild(child);
  throw new Error(`postgres not ready after ${readyTimeoutMs} ms: ${out.trim()}`);
}

export async function startLocalPg(options: LocalPgOptions = {}): Promise<LocalPgServer> {
  const { binDir, probe = canConnect, readyTimeoutMs = 30_000, attempts = 3 } = options;
  const runDir = await mkdtemp(path.join(options.dataRoot ?? tmpdir(), 'agentdesk-pg-'));
  try {
    const pwfile = path.join(runDir, 'pwfile');
    await writeFile(pwfile, `${LOCAL_PG_ADMIN.password}\n`, { mode: 0o600 });
    try {
      await run(pgBinary(binDir, 'initdb'), [
        '-D',
        path.join(runDir, 'data'),
        '-U',
        LOCAL_PG_ADMIN.user,
        `--pwfile=${pwfile}`,
        '--auth=scram-sha-256',
        '--encoding=UTF8',
        '--no-locale',
        '--no-sync',
      ]);
    } finally {
      await rm(pwfile, { force: true });
    }

    let lastError: unknown;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const { child, adminUrl } = await startServer(binDir, runDir, probe, readyTimeoutMs);
        // A crashed test process must not leave the server running.
        const onExit = (): void => void child.kill('SIGKILL');
        process.once('exit', onExit);
        let stopped = false;
        return {
          adminUrl,
          stop: async () => {
            if (stopped) return;
            stopped = true;
            process.off('exit', onExit);
            await stopChild(child);
            await rm(runDir, { recursive: true, force: true });
          },
        };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  } catch (e) {
    await rm(runDir, { recursive: true, force: true });
    throw e;
  }
}
