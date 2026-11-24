import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import {
  ENDING_DEADLINE_SECONDS,
  RECONNECT_WINDOW_SECONDS,
  IDLE_END_SECONDS,
  TERMINAL_LEASE_INTERVAL_SECONDS,
  TERMINAL_LEASE_TTL_SECONDS,
} from './temporal-names';

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
    HOST: blankDefault(z.string().min(1).default('0.0.0.0')),
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
    RUN_POD_MEMORY_LIMIT: blankDefault(z.string().default('2Gi')),
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
    /** Storage class of per-run volumes; unset uses the cluster default (dev only: required in production, see below). */
    RUN_VOLUME_STORAGE_CLASS: optional(z.string()),
    /** Finished runs per project whose kept session (volume) survives; older ones are cleaned up. */
    RUN_KEPT_DONE_SESSIONS_PER_PROJECT: blankDefault(z.coerce.number().int().min(0).default(10)),
    /**
     * Idle time before a run's pod is stopped (the run pauses). A test seam: lower it to see a pause quickly. Any value
     * but the default overrides every agent's `idleEndSeconds`; the default leaves each agent's setting in force.
     */
    RUN_IDLE_END_SECONDS: blankDefault(z.coerce.number().int().min(1).default(IDLE_END_SECONDS)),
    /** How long an ending session may take before the Job is deleted. A test seam like RUN_IDLE_END_SECONDS. */
    RUN_ENDING_DEADLINE_SECONDS: blankDefault(z.coerce.number().int().min(1).default(ENDING_DEADLINE_SECONDS)),
    /** How long the log follower keeps reconnecting to a lost cluster before it parks the run. */
    RUN_RECONNECT_WINDOW_SECONDS: blankDefault(z.coerce.number().int().min(1).default(RECONNECT_WINDOW_SECONDS)),
    /** How long a terminal's attach lease lives without a renewal. A test seam like RUN_IDLE_END_SECONDS. */
    RUN_LEASE_TTL_SECONDS: blankDefault(z.coerce.number().int().min(1).default(TERMINAL_LEASE_TTL_SECONDS)),
    RUN_SETUP_TIMEOUT_SECONDS: blankDefault(z.coerce.number().int().min(1).max(3300).default(600)),
    /** The most env entries (plain and secret together) one project may hold. */
    PROJECT_ENV_MAX_ENTRIES: blankDefault(z.coerce.number().int().min(1).default(500)),
    FAKE_STATE_DIR: blankDefault(z.string().default('.agentdesk/fake')),
    FAKE_WEBHOOK_SECRET: blankDefault(z.string().default('dev')),
    ENABLE_FAKE_PROVIDER: blankDefault(bool.default(false)),
    /** Where an agent's model list comes from: the provider's live list, or only the built-in names (local stack, e2e). */
    AGENT_MODELS_SOURCE: blankDefault(z.enum(['live', 'builtin']).default('live')),
    /** Where model list prices come from: `fake` (local stack, e2e, tests; not in production) or `off` (no sync, nothing priced). */
    MODEL_PRICES_SOURCE: blankDefault(z.enum(['litellm', 'fake', 'off']).default('litellm')),
    /** Replaces the selected price source's default URL: https only, no credentials, no fragment. Not a secret. */
    MODEL_PRICES_URL: optional(
      z
        .string()
        .max(2048)
        .refine((v) => {
          try {
            const u = new URL(v);
            return u.protocol === 'https:' && u.username === '' && u.password === '' && !v.includes('#');
          } catch {
            return false;
          }
        }, 'must be an https URL without credentials or a fragment, at most 2048 characters'),
    ),
    AUTH_DEV_LOGIN: blankDefault(bool.default(false)),
    SSE_SAFETY_TICK_MS: blankDefault(z.coerce.number().int().min(10).default(30000)),
    SSE_DRAIN_TIMEOUT_MS: blankDefault(z.coerce.number().int().min(10).default(30000)),
    SSE_HEARTBEAT_MS: blankDefault(z.coerce.number().int().min(10).default(15000)),
    TERMINAL_REAUTH_MS: blankDefault(z.coerce.number().int().min(10).default(60000)),
    /** How often the api sends a run's live terminal ids to its workflow. A test seam; keep it well under RUN_LEASE_TTL_SECONDS. */
    TERMINAL_LEASE_INTERVAL_MS: blankDefault(
      z.coerce
        .number()
        .int()
        .min(10)
        // setInterval treats a delay above 2^31-1 ms as 1 ms.
        .max(2 ** 31 - 1)
        .default(TERMINAL_LEASE_INTERVAL_SECONDS * 1000),
    ),
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
    // One missed tick must not drop an attached terminal's lease, so the interval is at most half the lease time.
    if (cfg.TERMINAL_LEASE_INTERVAL_MS * 2 > cfg.RUN_LEASE_TTL_SECONDS * 1000) {
      ctx.addIssue({
        code: 'custom',
        path: ['TERMINAL_LEASE_INTERVAL_MS'],
        message:
          'must be at most half of RUN_LEASE_TTL_SECONDS (in ms), so one missed lease signal does not drop a terminal',
      });
    }
    if (cfg.NODE_ENV === 'production') {
      if (cfg.AUTH_DEV_LOGIN) {
        ctx.addIssue({ code: 'custom', path: ['AUTH_DEV_LOGIN'], message: 'must not be true in production' });
      }
      if (cfg.ENABLE_FAKE_PROVIDER) {
        ctx.addIssue({ code: 'custom', path: ['ENABLE_FAKE_PROVIDER'], message: 'must not be true in production' });
      }
      if (cfg.MODEL_PRICES_SOURCE === 'fake') {
        ctx.addIssue({ code: 'custom', path: ['MODEL_PRICES_SOURCE'], message: 'must not be fake in production' });
      }
      if (cfg.KUBE_MODE === 'fake') {
        ctx.addIssue({
          code: 'custom',
          path: ['KUBE_MODE'],
          message: 'must be kubeconfig or incluster in production (fake is dev only)',
        });
      }
      if (cfg.RUN_VOLUME_STORAGE_CLASS === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['RUN_VOLUME_STORAGE_CLASS'],
          message:
            'must name a storage class with reclaimPolicy Delete in production (the cluster default can retain deleted run data)',
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
