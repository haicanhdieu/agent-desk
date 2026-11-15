import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, '..', 'agentdesk-status.mjs');

const run = async (args: string[]) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentdesk-status-'));
  const r = spawnSync(process.execPath, [script, ...args], {
    env: { PATH: process.env.PATH, AGENTDESK_STATE_DIR: dir },
    encoding: 'utf8',
  });
  return { r, file: join(dir, 'state.json') };
};

describe('agentdesk-status', () => {
  it.each(['done', 'needs_input'])('records a %s declaration and prints a confirmation', async (state) => {
    const { r, file } = await run([state, 'All good']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`status recorded: ${state}\n`);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ declared: { state, summary: 'All good' } });
  });

  it.each([[['working', 'x']], [['done']], [[]], [['done', 'a', 'b']]])(
    'rejects %j with usage and exit 2',
    async (args) => {
      const { r, file } = await run(args);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('usage');
      expect(existsSync(file)).toBe(false);
    },
  );
});
