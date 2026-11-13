import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

/** Env values arrive as strings; blank means "unset" (`.env.example` lists optional keys with empty values). */
const blankToUndefined = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());
/** Wrap a schema that carries its own `.default()` so a blank value falls back to it. */
const blankDefault = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema);

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const jsonValue = <T extends z.ZodType>(schema: T) =>
  z.string().transform((raw, ctx): z.infer<T> => {
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
      ctx.addIssue({ code: 'custom', message: z.prettifyError(parsed.error) });
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be valid JSON' });
    }
    return z.NEVER;
  });

const GITHUB_KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_PRIVATE_KEY',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
] as const;

const TolerationSchema = z.object({
  key: z.string().optional(),
  operator: z.enum(['Exists', 'Equal']).optional(),
  value: z.string().optional(),
  effect: z.enum(['NoSchedule', 'PreferNoSchedule', 'NoExecute']).optional(),
  tolerationSeconds: z.number().int().optional(),
});

export const ConfigSchema = z
  .object({
    NODE_ENV: blankDefault(z.enum(['development', 'test', 'production']).default('development')),
    PORT: blankDefault(z.coerce.number().int().min(1).max(65535).default(3000)),
    PUBLIC_ORIGIN: z.url(),
    DATABASE_APP_URL: z.string().min(1),
    DATABASE_OWNER_URL: z.string().min(1),
    DATABASE_ADMIN_URL: z.string().min(1),
    TEMPORAL_ADDRESS: z.string().min(1),
    TEMPORAL_NAMESPACE: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    GITHUB_APP_ID: optional(z.string()),
    GITHUB_APP_SLUG: optional(z.string()),
    GITHUB_PRIVATE_KEY: optional(z.string()),
    GITHUB_WEBHOOK_SECRET: optional(z.string()),
    GITHUB_CLIENT_ID: optional(z.string()),
    GITHUB_CLIENT_SECRET: optional(z.string()),
    KUBE_MODE: blankDefault(z.enum(['fake', 'kubeconfig', 'incluster']).default('fake')),
    KUBECONFIG: optional(z.string()),
    RUNS_NAMESPACE: blankDefault(z.string().default('agentdesk-runs')),
    APP_NAMESPACE: blankDefault(z.string().default('agentdesk')),
    RUNNER_IMAGE: z.string().min(1),
    RUN_POD_CPU_REQUEST: blankDefault(z.string().default('500m')),
    RUN_POD_CPU_LIMIT: blankDefault(z.string().default('2')),
    RUN_POD_MEMORY_REQUEST: blankDefault(z.string().default('1Gi')),
    RUN_POD_MEMORY_LIMIT: blankDefault(z.string().default('4Gi')),
    RUN_POD_EPHEMERAL_STORAGE_LIMIT: blankDefault(z.string().default('4Gi')),
    RUN_POD_WORKSPACE_SIZE_LIMIT: blankDefault(z.string().default('4Gi')),
    RUN_POD_NODE_SELECTOR: optional(jsonValue(z.record(z.string(), z.string()))),
    RUN_POD_TOLERATIONS: optional(jsonValue(z.array(TolerationSchema))),
    RUN_POD_RUNTIME_CLASS: optional(z.string()),
    /**
     * Approved plugin stores: store name -> marketplace source, or `builtin` for a store built in to the Claude Code
     * CLI (nothing to register). Platform config only, never repo text.
     */
    RUN_PLUGIN_MARKETPLACES: blankDefault(
      jsonValue(z.record(z.string(), z.string())).default({
        'claude-plugins-official': 'anthropics/claude-plugins-official',
        'anthropic-plugin-directory': 'builtin',
      }),
    ),
    RUN_SETUP_TIMEOUT_SECONDS: blankDefault(z.coerce.number().int().min(1).max(3300).default(600)),
    SETUP_TEST_TTL_SECONDS: blankDefault(z.coerce.number().int().min(60).max(3600).default(900)),
    FAKE_STATE_DIR: blankDefault(z.string().default('.agentdesk/fake')),
    FAKE_WEBHOOK_SECRET: blankDefault(z.string().default('dev')),
    ENABLE_FAKE_PROVIDER: blankDefault(bool.default(false)),
    AUTH_DEV_LOGIN: blankDefault(bool.default(false)),
    SSE_SAFETY_TICK_MS: blankDefault(z.coerce.number().int().min(10).default(30000)),
    SSE_DRAIN_TIMEOUT_MS: blankDefault(z.coerce.number().int().min(10).default(30000)),
    SSE_HEARTBEAT_MS: blankDefault(z.coerce.number().int().min(10).default(15000)),
    TERMINAL_REAUTH_MS: blankDefault(z.coerce.number().int().min(10).default(60000)),
    TERMINAL_PING_MS: blankDefault(z.coerce.number().int().min(10).default(30000)),
    POLL_MAX_BACKOFF_SECONDS: blankDefault(z.coerce.number().int().min(1).default(3600)),
    OTEL_EXPORTER_OTLP_ENDPOINT: optional(z.string()),
    /** Defaults to the app login `<GITHUB_APP_SLUG>[bot]` (see below), else `agentdesk[bot]`. */
    BOT_NAME: optional(z.string()),
    BOT_EMAIL: blankDefault(z.string().default('agentdesk-bot@users.noreply.local')),
  })
  .superRefine((cfg, ctx) => {
    const set = GITHUB_KEYS.filter((k) => cfg[k] !== undefined);
    if (set.length > 0 && set.length < GITHUB_KEYS.length) {
      const missing = GITHUB_KEYS.filter((k) => cfg[k] === undefined);
      ctx.addIssue({
        code: 'custom',
        path: [missing[0] ?? 'GITHUB_APP_ID'],
        message: `GITHUB_* keys are all-or-none; missing ${missing.join(', ')}`,
      });
    }
    if (cfg.NODE_ENV === 'production') {
      if (cfg.AUTH_DEV_LOGIN) {
        ctx.addIssue({ code: 'custom', path: ['AUTH_DEV_LOGIN'], message: 'must not be true in production' });
      }
      if (cfg.ENABLE_FAKE_PROVIDER) {
        ctx.addIssue({ code: 'custom', path: ['ENABLE_FAKE_PROVIDER'], message: 'must not be true in production' });
      }
      if (cfg.KUBE_MODE === 'fake') {
        ctx.addIssue({
          code: 'custom',
          path: ['KUBE_MODE'],
          message: 'must be kubeconfig or incluster in production (fake is dev only)',
        });
      }
    }
  })
  .transform((cfg) => ({
    ...cfg,
    // GitHub reports the app's own comments as `<slug>[bot]`; the router trusts that login, so the default must match.
    BOT_NAME: cfg.BOT_NAME ?? (cfg.GITHUB_APP_SLUG ? `${cfg.GITHUB_APP_SLUG}[bot]` : 'agentdesk[bot]'),
  }));

export type Config = z.infer<typeof ConfigSchema>;

/** Nearest ancestor of `start` (inclusive) that holds `pnpm-workspace.yaml`, or null. */
export function findWorkspaceRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Parses raw env into Config. Throws one Error naming every invalid key (values are never echoed).
 * A relative FAKE_STATE_DIR is resolved against the monorepo root (else `cwd`), so the api and the worker, which run
 * from different package directories, share one fake state dir (ruling R21).
 */
export function parseConfig(env: Record<string, string | undefined>, opts: { cwd?: string } = {}): Config {
  const result = ConfigSchema.safeParse(env);
  if (result.success) {
    const dir = result.data.FAKE_STATE_DIR;
    if (isAbsolute(dir)) return result.data;
    const cwd = opts.cwd ?? process.cwd();
    return { ...result.data, FAKE_STATE_DIR: resolve(findWorkspaceRoot(cwd) ?? cwd, dir) };
  }
  const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(config)'}: ${i.message}`);
  throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
}
