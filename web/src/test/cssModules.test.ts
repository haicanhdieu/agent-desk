import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Class names defined in a CSS module: every `.name` token outside of declaration blocks and comments. */
function definedClasses(css: string): Set<string> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set<string>();
  // Selector text is whatever precedes a `{`; collect `.ident` tokens from it.
  for (const m of stripped.matchAll(/([^{}]+)\{/g)) {
    for (const c of m[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(c[1]);
  }
  return names;
}

describe('CSS modules', () => {
  const files = walk(root).filter((f) => /\.tsx?$/.test(f));
  const problems: string[] = [];
  let checked = 0;

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const imp of src.matchAll(/import\s+(\w+)\s+from\s+'(\.[^']*\.module\.css)'/g)) {
      const [, ident, rel] = imp;
      const cssPath = resolve(dirname(file), rel);
      const defined = definedClasses(readFileSync(cssPath, 'utf8'));
      const used = new Set<string>();
      for (const m of src.matchAll(new RegExp(`\\b${ident}\\.([A-Za-z_]\\w*)`, 'g'))) used.add(m[1]);
      for (const m of src.matchAll(new RegExp(`\\b${ident}\\[\\s*['"]([^'"]+)['"]\\s*\\]`, 'g'))) used.add(m[1]);
      for (const key of used) {
        checked += 1;
        if (!defined.has(key)) problems.push(`${file.slice(root.length + 1)}: ${ident}.${key} is not defined in ${rel}`);
      }
    }
  }

  it('finds module usages to check', () => {
    expect(checked).toBeGreaterThan(100);
  });

  it('every referenced class key exists in its module', () => {
    expect(problems).toEqual([]);
  });
});
