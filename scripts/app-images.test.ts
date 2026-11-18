import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Static checks for the api, worker and web images. The images themselves are built and smoke-run by the
// `images / build` CI job (scripts/smoke-app-images.sh); these tests catch a pin or a user that slipped.
const root = resolve(__dirname, '..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

const NODE_APPS = ['api', 'worker'] as const;
const ALL = ['api', 'worker', 'web'] as const;

describe.each(ALL)('apps/%s/Dockerfile', (app) => {
  const text = read(`apps/${app}/Dockerfile`);
  const from = text.split('\n').filter((l) => l.startsWith('FROM '));

  it('pins every base image by sha256 digest', () => {
    expect(from.length).toBeGreaterThanOrEqual(2);
    for (const line of from) expect(line).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \w+)?$/);
  });

  it('runs as uid 10001 and installs with the frozen lockfile', () => {
    expect(text).toMatch(/^USER 10001:10001$/m);
    expect(text).toContain('pnpm install --frozen-lockfile');
  });

  it('builds from the repo root: copies by repo-relative path and names the app folder', () => {
    expect(text).toContain(`#   docker build -f apps/${app}/Dockerfile .`);
    expect(text).toMatch(new RegExp(`^COPY apps/${app}( |/)`, 'm'));
  });
});

describe.each(NODE_APPS)('apps/%s runtime', (app) => {
  const text = read(`apps/${app}/Dockerfile`);

  it('installs production dependencies of this app and its workspace packages only', () => {
    expect(text).toContain(`pnpm install --frozen-lockfile --prod --filter @agentdesk/${app}...`);
  });

  it('starts from the app folder with tsx, the way the package start script does', () => {
    expect(text).toContain(`WORKDIR /app/apps/${app}`);
    expect(text).toMatch(/^CMD \["node", "--import", "tsx", "src\/main\.ts"\]$/m);
    expect(JSON.parse(read(`apps/${app}/package.json`)).scripts.start).toBe('tsx src/main.ts');
  });

  it('lists tsx as a dependency, because the image starts through it', () => {
    const pkg = JSON.parse(read(`apps/${app}/package.json`)) as { dependencies: Record<string, string> };
    expect(pkg.dependencies).toHaveProperty('tsx');
  });
});

describe('api migrate entry', () => {
  it('is src/migrate.ts, the file the package migrate script runs', () => {
    expect(JSON.parse(read('apps/api/package.json')).scripts.migrate).toContain('src/migrate.ts');
    expect(read('apps/api/Dockerfile')).toContain('node --import tsx src/migrate.ts');
  });
});

describe('core runtime dependencies', () => {
  it('lists undici as a dependency: follow-log.ts imports it at run time', () => {
    const pkg = JSON.parse(read('packages/core/package.json')) as { dependencies: Record<string, string> };
    expect(read('packages/core/src/kube/follow-log.ts')).toContain("from 'undici'");
    expect(pkg.dependencies).toHaveProperty('undici');
  });

  it('lists @temporalio/common as a worker dependency: activities import it at run time', () => {
    const pkg = JSON.parse(read('apps/worker/package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies).toHaveProperty('@temporalio/common');
  });
});

describe('apps/web serving', () => {
  const dockerfile = read('apps/web/Dockerfile');
  const conf = read('apps/web/nginx.conf');

  it('uses nginx-unprivileged on port 8080', () => {
    expect(dockerfile).toMatch(/^FROM nginxinc\/nginx-unprivileged:\S+@sha256:[0-9a-f]{64} AS runtime$/m);
    expect(dockerfile).toContain('EXPOSE 8080');
    expect(conf).toMatch(/^\s*listen 8080;$/m);
  });

  it('falls back to index.html for unknown paths', () => {
    expect(conf).toMatch(/try_files \$uri \/index\.html;/);
  });

  it('caches hashed assets as immutable and never caches index.html', () => {
    const assets = /location \/assets\/ \{([^}]*)\}/.exec(conf)?.[1] ?? '';
    expect(assets).toContain('immutable');
    expect(assets).toContain('try_files $uri =404;');
    const index = /location = \/index\.html \{([^}]*)\}/.exec(conf)?.[1] ?? '';
    expect(index).toContain('Cache-Control "no-cache"');
  });
});

describe('.dockerignore', () => {
  const lines = read('.dockerignore')
    .split('\n')
    .filter((l) => l !== '' && !l.startsWith('#'));

  it.each(['**/node_modules', '.git', '.env', '.env.*', '*.pem'])('keeps %s out of the build context', (pattern) => {
    expect(lines).toContain(pattern);
  });
});
