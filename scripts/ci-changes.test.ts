import { describe, expect, it } from 'vitest';
import { needsCodeGates, parseChangedFiles } from './ci-changes';

describe('needsCodeGates', () => {
  it('skips the code gates when only docs change', () => {
    expect(needsCodeGates(['docs/runbooks/dev-workflow.md', 'docs/adr/0001-x.md'])).toBe(false);
  });

  it('skips the code gates for agent skill files and root markdown', () => {
    expect(needsCodeGates(['.agent/skills/create-pr/SKILL.md', 'AGENTS.md', 'apps/web/README.md'])).toBe(false);
  });

  it('runs the code gates when any source file changes', () => {
    expect(needsCodeGates(['docs/a.md', 'packages/core/src/index.ts'])).toBe(true);
  });

  it('runs the code gates for CI, lockfile and package changes', () => {
    expect(needsCodeGates(['.github/workflows/ci.yml'])).toBe(true);
    expect(needsCodeGates(['pnpm-lock.yaml'])).toBe(true);
    expect(needsCodeGates(['package.json'])).toBe(true);
    expect(needsCodeGates(['scripts/ci-changes.ts'])).toBe(true);
  });

  it('runs the code gates for non-markdown files under docs or skills', () => {
    expect(needsCodeGates(['docs/diagram.ts'])).toBe(true);
    expect(needsCodeGates(['.agent/skills/x/run.sh'])).toBe(true);
    expect(needsCodeGates(['.agent/models.json'])).toBe(true);
  });

  it('fails safe: an empty file list runs the code gates', () => {
    expect(needsCodeGates([])).toBe(true);
  });
});

describe('parseChangedFiles', () => {
  it('splits git output into paths and drops blank lines', () => {
    expect(parseChangedFiles('a.md\n\ndocs/b.md\n')).toEqual(['a.md', 'docs/b.md']);
  });
});
