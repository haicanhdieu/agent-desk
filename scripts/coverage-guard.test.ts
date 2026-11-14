import { describe, expect, it } from 'vitest';
import {
  checkConfigWidening,
  checkIgnoreComments,
  checkThresholdsNotLowered,
  extractCoverageLists,
  hasJustification,
  parseDiff,
  protectedFilesTouched,
  runGuard,
} from './coverage-guard';

// Built from parts so this file does not itself contain the literal marker comments the guard looks for.
const IGNORE = ['v8', 'ignore'].join(' ');
const HEADING = '## Coverage exceptions';
const GOOD_BODY = `## Summary\n\nstuff\n\n${HEADING}\n\nThe fallback branch is unreachable because the schema rejects it earlier.\n`;

const fileDiff = (path: string, added: string[], removed: string[] = []): string =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,1 +1,1 @@',
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    '',
  ].join('\n');

describe('parseDiff', () => {
  it('collects added and removed lines per file and skips file headers', () => {
    const files = parseDiff(fileDiff('src/a.ts', ['one', 'two'], ['old']));
    expect(files).toEqual([{ path: 'src/a.ts', added: ['one', 'two'], removed: ['old'] }]);
  });

  it('uses the old path for a deleted file', () => {
    const diff = 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n';
    expect(parseDiff(diff)).toEqual([{ path: 'x.ts', added: [], removed: ['gone'] }]);
  });
});

describe('checkIgnoreComments', () => {
  it.each([`/* ${IGNORE} next */`, `// ${IGNORE} start`, `  /* c8 ignore next 3 */`, `// istanbul ignore else`])(
    'flags an added %s comment',
    (comment) => {
      const v = checkIgnoreComments(parseDiff(fileDiff('packages/core/src/a.ts', [`const x = 1; ${comment}`])));
      expect(v).toHaveLength(1);
      expect(v[0]?.file).toBe('packages/core/src/a.ts');
    },
  );

  it('does not flag a removed ignore comment', () => {
    const diff = fileDiff('packages/core/src/a.ts', ['const x = 1;'], [`/* ${IGNORE} next */`]);
    expect(checkIgnoreComments(parseDiff(diff))).toEqual([]);
  });

  it('does not flag non-source files such as docs', () => {
    expect(checkIgnoreComments(parseDiff(fileDiff('docs/x.md', [`/* ${IGNORE} next */`])))).toEqual([]);
  });
});

describe('hasJustification', () => {
  it('accepts a real explanation under the heading', () => {
    expect(hasJustification(GOOD_BODY)).toBe(true);
  });

  it('rejects a missing heading', () => {
    expect(hasJustification('## Summary\n\nthis is a long enough sentence of text here')).toBe(false);
  });

  it.each(['N/A', 'none', '-', 'None needed.', 'n/a n/a n/a n/a n/a n/a n/a n/a'])('rejects placeholder %s', (text) => {
    expect(hasJustification(`${HEADING}\n\n${text}\n`)).toBe(false);
  });

  it('rejects a heading with nothing under it', () => {
    expect(hasJustification(`${HEADING}\n\n## Next\n\nplenty of words here that belong to the next section`)).toBe(
      false,
    );
    expect(hasJustification(`${HEADING}\n`)).toBe(false);
  });

  it('does not count text that follows the next heading', () => {
    expect(hasJustification(`${HEADING}\nshort\n## Other\nthis text is long enough but is in another section`)).toBe(
      false,
    );
  });

  it('ignores html comments from the PR template', () => {
    expect(
      hasJustification(`${HEADING}\n\n<!-- explain every ignore comment or lowered threshold here, please -->\n`),
    ).toBe(false);
  });

  it('handles CRLF line endings', () => {
    expect(hasJustification(GOOD_BODY.replace(/\n/g, '\r\n'))).toBe(true);
  });
});

const cfg = (exclude: string[], include = ["'src/**'"]): string =>
  `export default { test: { coverage: {\n provider: 'v8',\n include: [${include.join(', ')}],\n exclude: [\n${exclude
    .map((e) => `  ${e},`)
    .join('\n')}\n ],\n } } };`;

describe('extractCoverageLists', () => {
  it('reads multi-line and flat arrays, ignoring braces inside strings and comments', () => {
    const text = `export default { test: { include: ['x'], coverage: {
      include: ['src/**/*.{ts,tsx}'], // not exclude: ['nope']
      exclude: ['a', "b", \`c\`,
        /* 'hidden' */ 'd'],
    } } }`;
    expect(extractCoverageLists(text)).toEqual({ include: ['src/**/*.{ts,tsx}'], exclude: ['a', 'b', 'c', 'd'] });
  });

  it('returns empty lists when there is no coverage block', () => {
    expect(extractCoverageLists('export default {}')).toEqual({ include: [], exclude: [] });
  });

  it('keeps a non-literal entry so a spread cannot hide an exclusion', () => {
    expect(extractCoverageLists("x = { coverage: { exclude: ['a', ...more] } }").exclude).toEqual([
      'a',
      '<expr:...more>',
    ]);
  });
});

describe('checkConfigWidening', () => {
  const base = cfg(["'a'", "'b'"]);
  it('fails when an exclude entry is added', () => {
    const v = checkConfigWidening('vitest.config.ts', base, cfg(["'a'", "'b'", "'c'"]));
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("'c'");
  });

  it('passes when an exclude entry is removed (narrowed)', () => {
    expect(checkConfigWidening('vitest.config.ts', base, cfg(["'a'"]))).toEqual([]);
  });

  it('fails when an include entry is removed', () => {
    expect(checkConfigWidening('vitest.config.ts', base, cfg(["'a'", "'b'"], []))).toHaveLength(1);
  });

  it('passes when an include entry is added or order changes', () => {
    expect(checkConfigWidening('vitest.config.ts', base, cfg(["'b'", "'a'"], ["'src/**'", "'lib/**'"]))).toEqual([]);
  });

  it('passes on first introduction (no base copy)', () => {
    expect(checkConfigWidening('vitest.config.ts', undefined, base)).toEqual([]);
  });
});

const thresholds = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    packages: { api: { lines: 70, branches: 60 }, web: { lines: 60 } },
    patch: { lines: 80 },
    sensitive: [{ name: 'auth', globs: ['apps/api/src/auth/**'], lines: 90, branches: 72 }],
    ...over,
  });

describe('checkThresholdsNotLowered', () => {
  const base = thresholds();
  it('passes when unchanged', () => {
    expect(checkThresholdsNotLowered(base, base)).toEqual([]);
  });

  it('fails when a package lines value drops', () => {
    const pr = thresholds({ packages: { api: { lines: 69, branches: 60 }, web: { lines: 60 } } });
    expect(checkThresholdsNotLowered(base, pr)[0]?.message).toContain('api');
  });

  it('fails when a package branches value is dropped or removed', () => {
    const pr = thresholds({ packages: { api: { lines: 70 }, web: { lines: 60 } } });
    expect(checkThresholdsNotLowered(base, pr)).toHaveLength(1);
  });

  it('fails when a package is removed', () => {
    expect(
      checkThresholdsNotLowered(base, thresholds({ packages: { api: { lines: 70, branches: 60 } } })),
    ).toHaveLength(1);
  });

  it('fails when patch lines drop', () => {
    expect(checkThresholdsNotLowered(base, thresholds({ patch: { lines: 70 } }))).toHaveLength(1);
  });

  it('fails when a sensitive group is removed', () => {
    expect(checkThresholdsNotLowered(base, thresholds({ sensitive: [] }))).toHaveLength(1);
  });

  it('fails when a sensitive value drops', () => {
    const pr = thresholds({ sensitive: [{ name: 'auth', globs: ['apps/api/src/auth/**'], lines: 90, branches: 50 }] });
    expect(checkThresholdsNotLowered(base, pr)).toHaveLength(1);
  });

  it('fails when a sensitive glob is shrunk or edited, passes when one is added', () => {
    const group = (globs: string[]) => [{ name: 'auth', globs, lines: 90, branches: 72 }];
    expect(checkThresholdsNotLowered(base, thresholds({ sensitive: group(['apps/api/src/other/**']) }))).toHaveLength(
      1,
    );
    const wider = thresholds({ sensitive: group(['apps/api/src/auth/**', 'apps/api/src/more/**']) });
    expect(checkThresholdsNotLowered(base, wider)).toEqual([]);
  });

  it('passes when raised, and when a package or group is added', () => {
    const pr = thresholds({
      packages: { api: { lines: 75, branches: 65 }, web: { lines: 60 }, extra: { lines: 50 } },
      patch: { lines: 85 },
      sensitive: [
        { name: 'auth', globs: ['apps/api/src/auth/**'], lines: 95, branches: 80 },
        { name: 'new', globs: ['x/**'], lines: 80 },
      ],
    });
    expect(checkThresholdsNotLowered(base, pr)).toEqual([]);
  });

  it('passes on first introduction (no base copy)', () => {
    expect(checkThresholdsNotLowered(undefined, base)).toEqual([]);
  });
});

describe('protectedFilesTouched', () => {
  it('lists coverage config, thresholds, baseline, scripts, vitest configs and ci.yml', () => {
    const paths = [
      'coverage-thresholds.json',
      'coverage-baseline.json',
      'scripts/coverage-check.ts',
      'scripts/coverage-check.test.ts',
      'apps/web/vite.config.ts',
      'packages/core/vitest.config.ts',
      'images/runner/vitest.config.ts',
      '.github/workflows/ci.yml',
      'apps/api/src/main.ts',
      'scripts/ci-matrix.ts',
    ];
    expect(protectedFilesTouched(paths)).toEqual(paths.slice(0, 8));
  });
});

describe('runGuard', () => {
  const inputs = (over: Partial<Parameters<typeof runGuard>[0]> = {}): Parameters<typeof runGuard>[0] => ({
    diff: fileDiff('packages/core/src/a.ts', [`/* ${IGNORE} next */`]),
    prBody: '',
    base: {},
    pr: {},
    ...over,
  });

  it('fails an ignore comment without justification, with an ::error annotation and the exact heading', () => {
    const r = runGuard(inputs());
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/^::error file=packages\/core\/src\/a\.ts::/m);
    expect(r.output).toContain(HEADING);
  });

  it('passes the same diff with a valid justification', () => {
    const r = runGuard(inputs({ prBody: GOOD_BODY }));
    expect(r.ok).toBe(true);
    expect(r.output).not.toContain('::error');
  });

  it('rejects N/A as justification', () => {
    expect(runGuard(inputs({ prBody: `${HEADING}\n\nN/A\n` })).ok).toBe(false);
  });

  it('checks config widening using base and PR copies', () => {
    const diff = fileDiff('apps/web/vite.config.ts', ['x']);
    const r = runGuard(
      inputs({
        diff,
        base: { 'apps/web/vite.config.ts': cfg(["'a'"]) },
        pr: { 'apps/web/vite.config.ts': cfg(["'a'", "'b'"]) },
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.output).toContain('::error file=apps/web/vite.config.ts::');
  });

  it('checks thresholds using base and PR copies, and passes when the copy is missing on base', () => {
    const diff = fileDiff('coverage-thresholds.json', ['x']);
    const lowered = runGuard(
      inputs({
        diff,
        base: { 'coverage-thresholds.json': thresholds() },
        pr: { 'coverage-thresholds.json': thresholds({ patch: { lines: 10 } }) },
      }),
    );
    expect(lowered.ok).toBe(false);
    const first = runGuard(inputs({ diff, pr: { 'coverage-thresholds.json': thresholds() } }));
    expect(first.ok).toBe(true);
  });

  it('prints a notice listing protected files and does not fail on them alone', () => {
    const diff = fileDiff('coverage-baseline.json', ['x']) + fileDiff('scripts/coverage-guard.ts', ['y']);
    const r = runGuard(inputs({ diff }));
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/^::notice::.*coverage-baseline\.json.*scripts\/coverage-guard\.ts/m);
  });

  it('prints no notice when no protected file is touched', () => {
    const r = runGuard(inputs({ diff: fileDiff('apps/api/src/a.ts', ['x']) }));
    expect(r.output).toBe('');
    expect(r.ok).toBe(true);
  });

  it('treats a PR body with shell metacharacters as plain text', () => {
    const body = `${HEADING}\n\n$(rm -rf /) \`id\` "quoted" 'single' ; echo pwned && cat /etc/passwd\n`;
    expect(runGuard(inputs({ prBody: body })).ok).toBe(true);
  });

  it('escapes workflow-command characters in annotation text', () => {
    const r = runGuard(inputs({ diff: fileDiff('a,b::c.ts', [`// ${IGNORE} next`]) }));
    expect(r.output).toContain('::error file=a%2Cb%3A%3Ac.ts::');
  });
});
