import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freePort, pgBinary, postgresArgs, startLocalPg } from '../src/local-pg';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'local-pg-test-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Writes an executable shell stub `name` into `dir`. */
async function stub(dir: string, name: string, body: string): Promise<void> {
  const file = path.join(dir, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
}

async function binDirWith(initdb: string, postgres: string): Promise<{ binDir: string; dataRoot: string }> {
  const binDir = path.join(root, 'bin');
  const dataRoot = path.join(root, 'data');
  await Promise.all([mkdir(binDir), mkdir(dataRoot)]);
  await stub(binDir, 'initdb', initdb);
  await stub(binDir, 'postgres', postgres);
  return { binDir, dataRoot };
}

describe('pgBinary', () => {
  it('resolves inside the bin dir when one is given', () => {
    expect(pgBinary('/opt/pg/bin', 'initdb')).toBe('/opt/pg/bin/initdb');
  });

  it('falls back to PATH lookup by bare name', () => {
    expect(pgBinary(undefined, 'postgres')).toBe('postgres');
  });
});

describe('postgresArgs', () => {
  it('listens on loopback only, keeps the socket in the run dir and turns durability off', () => {
    const args = postgresArgs('/r/data', '/r', 5433);
    expect(args.slice(0, 8)).toEqual(['-D', '/r/data', '-p', '5433', '-k', '/r', '-h', '127.0.0.1']);
    expect(args).toContain('fsync=off');
    expect(args).toContain('synchronous_commit=off');
  });
});

describe('freePort', () => {
  it('returns a port that can be bound', async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(0);
    await new Promise<void>((resolve, reject) => {
      const srv = createServer();
      srv.once('error', reject);
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve()));
    });
  });
});

describe('startLocalPg', () => {
  it('starts the server, reports an admin URL on loopback, and removes its run dir on stop', async () => {
    const { binDir, dataRoot } = await binDirWith('exit 0', 'exec sleep 30');
    const seen: string[] = [];
    const server = await startLocalPg({
      binDir,
      dataRoot,
      probe: async (url) => {
        seen.push(url);
        return seen.length >= 2;
      },
    });
    const url = new URL(server.adminUrl);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.username).toBe('postgres');
    expect(url.pathname).toBe('/postgres');
    expect(seen.every((s) => s === server.adminUrl)).toBe(true);
    expect(await readdir(dataRoot)).toHaveLength(1);

    await server.stop();
    expect(await readdir(dataRoot)).toHaveLength(0);
    await server.stop();
  });

  it('removes the password file before the server starts', async () => {
    const { binDir, dataRoot } = await binDirWith('exit 0', 'exec sleep 30');
    let files: string[] = [];
    const server = await startLocalPg({
      binDir,
      dataRoot,
      probe: async () => {
        const [run] = await readdir(dataRoot);
        files = run === undefined ? [] : await readdir(path.join(dataRoot, run));
        return true;
      },
    });
    await server.stop();
    expect(files).not.toContain('pwfile');
  });

  it('fails with the initdb output and cleans up when initdb fails', async () => {
    const { binDir, dataRoot } = await binDirWith('echo "initdb: boom" >&2; exit 3', 'exec sleep 30');
    await expect(startLocalPg({ binDir, dataRoot, probe: async () => true })).rejects.toThrow(/initdb.*boom/s);
    expect(await readdir(dataRoot)).toHaveLength(0);
  });

  it('fails with the server output when postgres exits before it is ready', async () => {
    const { binDir, dataRoot } = await binDirWith('exit 0', 'echo "FATAL: could not bind" >&2; exit 1');
    await expect(startLocalPg({ binDir, dataRoot, probe: async () => false, attempts: 2 })).rejects.toThrow(
      /could not bind/,
    );
    expect(await readdir(dataRoot)).toHaveLength(0);
  });

  it('by default waits for a real connection, which a process that does not listen never accepts', async () => {
    const { binDir, dataRoot } = await binDirWith('exit 0', 'exec sleep 30');
    await expect(startLocalPg({ binDir, dataRoot, readyTimeoutMs: 500 })).rejects.toThrow(/not ready/);
  });

  it('gives up when the server never becomes ready', async () => {
    const { binDir, dataRoot } = await binDirWith('exit 0', 'exec sleep 30');
    await expect(startLocalPg({ binDir, dataRoot, probe: async () => false, readyTimeoutMs: 300 })).rejects.toThrow(
      /not ready/,
    );
    expect(await readdir(dataRoot)).toHaveLength(0);
  });
});
