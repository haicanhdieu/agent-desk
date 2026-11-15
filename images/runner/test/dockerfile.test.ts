import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dockerfile = join(import.meta.dirname, '..', 'Dockerfile');

describe('runner Dockerfile', () => {
  it('installs gh from the official GitHub CLI apt repo, not Debian (Debian ships 2.23, which has no `gh project`)', async () => {
    const text = await readFile(dockerfile, 'utf8');
    const baseInstall = text.split('\n').find((l) => l.includes('apt-get install') && l.includes('git'));
    expect(baseInstall).toBeDefined();
    expect(baseInstall).not.toMatch(/\bgh\b/);
    expect(text).toContain('cli.github.com/packages');
    expect(text).toMatch(/apt-get install -y --no-install-recommends gh\b/);
  });
});
