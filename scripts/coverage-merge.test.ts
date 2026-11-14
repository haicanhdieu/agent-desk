import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  discoverArtifacts,
  mergeArtifacts,
  mergeCoverage,
  normalizeCoverage,
  normalizePath,
  renderSummaryTable,
  type CoverageData,
} from './coverage-merge';

const range = (line: number) => ({ start: { line, column: 0 }, end: { line, column: 10 } });

/** One-file coverage: statements s0..sN at lines 1..N; `hit` lists the statement ids that ran. */
function fileCov(file: string, statements: number, hit: number[]): CoverageData {
  const statementMap: Record<string, ReturnType<typeof range>> = {};
  const s: Record<string, number> = {};
  for (let i = 0; i < statements; i++) {
    statementMap[String(i)] = range(i + 1);
    s[String(i)] = hit.includes(i) ? 1 : 0;
  }
  return { [file]: { path: file, statementMap, fnMap: {}, branchMap: {}, s, f: {}, b: {} } };
}

const RUNNER = '/home/runner/work/agent-desk/agent-desk';

function writeArtifact(root: string, name: string, data: unknown): void {
  mkdirSync(path.join(root, name), { recursive: true });
  writeFileSync(path.join(root, name, 'coverage-final.json'), JSON.stringify(data));
}

const tmp = (): string => mkdtempSync(path.join(tmpdir(), 'cov-merge-'));

describe('normalizePath', () => {
  it('makes a runner path repo-relative', () => {
    expect(normalizePath(`${RUNNER}/packages/core/src/a.ts`)).toBe('packages/core/src/a.ts');
  });

  it('strips an explicit repo root', () => {
    expect(normalizePath('/x/y/packages/db/src/a.ts', '/x/y')).toBe('packages/db/src/a.ts');
  });

  it('leaves an already relative path alone', () => {
    expect(normalizePath('apps/api/src/a.ts')).toBe('apps/api/src/a.ts');
  });
});

describe('normalizeCoverage', () => {
  it('rewrites both the key and the inner path', () => {
    const out = normalizeCoverage(fileCov(`${RUNNER}/apps/api/src/a.ts`, 1, [0]));
    expect(Object.keys(out)).toEqual(['apps/api/src/a.ts']);
    expect(out['apps/api/src/a.ts']?.path).toBe('apps/api/src/a.ts');
  });
});

describe('mergeCoverage', () => {
  it('unions the covered statements of the same file across inputs', () => {
    const unit = fileCov(`${RUNNER}/packages/core/src/a.ts`, 4, [0, 1]);
    const integ = fileCov('/other/packages/core/src/a.ts', 4, [2]);
    const map = mergeCoverage([unit, integ]);
    expect(map.files()).toEqual(['packages/core/src/a.ts']);
    expect(map.fileCoverageFor('packages/core/src/a.ts').toSummary().statements.covered).toBe(3);
  });

  it('keeps a file that is only in one input', () => {
    const map = mergeCoverage([
      fileCov(`${RUNNER}/packages/core/src/a.ts`, 2, [0]),
      fileCov(`${RUNNER}/packages/core/src/b.ts`, 2, [0, 1]),
    ]);
    expect(map.files().sort()).toEqual(['packages/core/src/a.ts', 'packages/core/src/b.ts']);
  });
});

describe('discoverArtifacts', () => {
  it('parses package, kind and shard from the artifact directory name', () => {
    const root = tmp();
    writeArtifact(root, 'coverage-api-unit', {});
    writeArtifact(root, 'coverage-db-integration-2', {});
    const found = discoverArtifacts(root).map(({ pkg, kind, shard }) => ({ pkg, kind, shard }));
    expect(found).toEqual([
      { pkg: 'api', kind: 'unit', shard: undefined },
      { pkg: 'db', kind: 'integration', shard: '2' },
    ]);
  });

  it('fails clearly when the directory has no artifacts', () => {
    expect(() => discoverArtifacts(tmp())).toThrow(/no coverage artifacts/i);
  });

  it('fails clearly when the directory does not exist', () => {
    expect(() => discoverArtifacts(path.join(tmp(), 'missing'))).toThrow(/no coverage artifacts/i);
  });
});

describe('mergeArtifacts', () => {
  it('writes per-package merged files and a combined summary', () => {
    const root = tmp();
    const out = path.join(tmp(), 'out');
    writeArtifact(root, 'coverage-core-unit', fileCov(`${RUNNER}/packages/core/src/a.ts`, 4, [0, 1]));
    writeArtifact(root, 'coverage-core-integration-1', fileCov(`${RUNNER}/packages/core/src/a.ts`, 4, [2]));
    writeArtifact(root, 'coverage-web-unit', fileCov(`${RUNNER}/apps/web/src/w.ts`, 2, [0, 1]));

    const summary = mergeArtifacts(root, out);

    expect(summary['core']?.statements).toBe(75);
    expect(summary['web']?.statements).toBe(100);
    expect(Object.keys(summary['core'] ?? {}).sort()).toEqual(['branches', 'functions', 'lines', 'statements']);
    const perPkg = JSON.parse(readFileSync(path.join(out, 'core', 'coverage-summary.json'), 'utf8')) as Record<
      string,
      { statements: { pct: number } }
    >;
    expect(perPkg['total']?.statements.pct).toBe(75);
    expect(perPkg['packages/core/src/a.ts']?.statements.pct).toBe(75);
    expect(readFileSync(path.join(out, 'core', 'coverage-final.json'), 'utf8')).toContain('packages/core/src/a.ts');
    expect(JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8'))).toEqual(summary);
  });

  it('fails clearly on an empty coverage file', () => {
    const root = tmp();
    mkdirSync(path.join(root, 'coverage-core-unit'));
    writeFileSync(path.join(root, 'coverage-core-unit', 'coverage-final.json'), '');
    expect(() => mergeArtifacts(root, tmp())).toThrow(/coverage-core-unit.*not valid JSON/s);
  });

  it('fails clearly when a coverage file holds no files', () => {
    const root = tmp();
    writeArtifact(root, 'coverage-core-unit', {});
    expect(() => mergeArtifacts(root, tmp())).toThrow(/coverage-core-unit.*no files/s);
  });
});

describe('renderSummaryTable', () => {
  it('renders one markdown row per package', () => {
    const table = renderSummaryTable({ core: { lines: 80, branches: 70.5, functions: 90, statements: 81.25 } });
    expect(table).toContain('| Package | Lines | Branches | Functions | Statements |');
    expect(table).toContain('| core | 80.00% | 70.50% | 90.00% | 81.25% |');
  });
});

describe('combined cobertura report', () => {
  const lineHits = (xml: string, file: string): Record<string, number> => {
    const cls = new RegExp(`<class [^>]*filename="${file.replace(/[./]/g, '\\$&')}"[\\s\\S]*?</class>`).exec(xml);
    if (cls === null) throw new Error(`${file} not in report`);
    const hits: Record<string, number> = {};
    const lines = /<lines>([\s\S]*?)<\/lines>\s*<\/class>/.exec(cls[0])?.[1] ?? '';
    for (const m of lines.matchAll(/<line number="(\d+)" hits="(\d+)"/g)) hits[m[1] ?? ''] = Number(m[2]);
    return hits;
  };

  it('lists files from two packages with repo-relative paths and the merged union of hits', () => {
    const artifacts = tmp();
    const out = path.join(tmp(), 'merged');
    writeArtifact(artifacts, 'coverage-core-unit', fileCov(`${RUNNER}/packages/core/src/a.ts`, 3, [0]));
    writeArtifact(artifacts, 'coverage-core-integration-1', fileCov(`${RUNNER}/packages/core/src/a.ts`, 3, [1]));
    writeArtifact(artifacts, 'coverage-api-unit', fileCov(`${RUNNER}/apps/api/src/b.ts`, 2, [1]));
    mergeArtifacts(artifacts, out);
    const xml = readFileSync(path.join(out, 'cobertura.xml'), 'utf8');
    expect(xml).not.toContain(RUNNER);
    expect(lineHits(xml, 'packages/core/src/a.ts')).toEqual({ '1': 1, '2': 1, '3': 0 });
    expect(lineHits(xml, 'apps/api/src/b.ts')).toEqual({ '1': 0, '2': 1 });
  });

  it('ignores an unknown package directory instead of crashing', () => {
    const artifacts = tmp();
    const out = path.join(tmp(), 'merged');
    writeArtifact(artifacts, 'coverage-core-unit', fileCov('packages/core/src/a.ts', 1, [0]));
    writeArtifact(artifacts, 'something-else', fileCov('packages/zzz/src/z.ts', 1, [0]));
    mergeArtifacts(artifacts, out);
    const xml = readFileSync(path.join(out, 'cobertura.xml'), 'utf8');
    expect(xml).toContain('packages/core/src/a.ts');
    expect(xml).not.toContain('zzz');
  });
});
