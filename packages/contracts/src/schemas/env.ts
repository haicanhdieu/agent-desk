import { z } from 'zod';
import { Timestamp } from './common';
import { PageQuery } from './page';

export const ENV_NAME_MAX = 128;
export const ENV_VALUE_MAX_BYTES = 8192;
/** Sum of UTF-8 bytes of every name and value of a project, both kinds. Fixed, not configurable. */
export const ENV_MAX_TOTAL_BYTES = 262144;
/**
 * The API gives both limit 409s the title "Conflict"; the web tells them apart by the start of their detail, so these
 * two prefixes are the contract (API `checkLimits`, web `envSaveError`, the web mock).
 */
export const ENV_CAP_DETAIL_PREFIX = 'This project already has the maximum of ';
export const ENV_SIZE_DETAIL_PREFIX = 'Names and values together cannot exceed ';
/** Shorter secrets are not redacted from run output (`MIN_SECRET_LENGTH` in the worker). */
export const SECRET_VALUE_MIN_LENGTH = 6;

/** Names the platform sets for the Pod or the agent. Case-sensitive. */
export const RESERVED_ENV_NAMES: readonly string[] = [
  'PATH',
  'HOME',
  'SHELL',
  'IFS',
  'PS4',
  'ENV',
  'BASH_ENV',
  'NODE_OPTIONS',
  'REPO_CLONE_URL',
  'PROMPT',
  'CHECKOUT_REF',
  'RESUME_NOTE',
  'MAX_TURNS',
  'GH_TOKEN',
  'GITHUB_TOKEN',
];

export const RESERVED_ENV_PREFIXES: readonly string[] = [
  'BASH_',
  'LD_',
  'TMUX',
  'KUBERNETES_',
  'BOT_',
  'RUN_',
  'SETUP_',
  'PLUGIN_',
  'AGENT_',
  'AGENTDESK_',
  'ANTHROPIC_',
  'CLAUDE_',
];

export function isReservedEnvName(name: string): boolean {
  return RESERVED_ENV_NAMES.includes(name) || RESERVED_ENV_PREFIXES.some((p) => name.startsWith(p));
}

export const EnvName = z
  .string()
  .min(1, 'Enter a name.')
  .max(ENV_NAME_MAX, `Use ${ENV_NAME_MAX} characters or fewer.`)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, digits and _, and do not start with a digit.')
  .refine((n) => !isReservedEnvName(n), {
    error: (issue) => `${String(issue.input)} is reserved: Agent Desk sets it for every run.`,
  });
export type EnvName = z.infer<typeof EnvName>;

/** Both kinds: at most 8 KiB in UTF-8 bytes (like `SetupScriptBody`), a single line, no NUL. */
export const EnvVarValue = z
  .string()
  .refine((s) => new TextEncoder().encode(s).length <= ENV_VALUE_MAX_BYTES, 'Use 8 KiB or less.')
  .refine((s) => !['\r', '\n', '\u0000'].some((c) => s.includes(c)), 'A value cannot contain a line break.');
export type EnvVarValue = z.infer<typeof EnvVarValue>;

export const EnvSecretValue = EnvVarValue.refine((s) => s.length > 0, 'Enter a value.').refine(
  (s) => s.length === 0 || s.length >= SECRET_VALUE_MIN_LENGTH,
  'Too short to hide in logs.',
);
export type EnvSecretValue = z.infer<typeof EnvSecretValue>;

export const EnvKind = z.enum(['plain', 'secret']);
export type EnvKind = z.infer<typeof EnvKind>;

/** `value` is always null for a secret: no value, length or hash ever leaves the API. */
export const EnvEntryDto = z.object({
  name: z.string(),
  kind: EnvKind,
  value: z.string().nullable(),
  updatedAt: Timestamp,
  updatedBy: z.string(),
});
export type EnvEntryDto = z.infer<typeof EnvEntryDto>;

export const EnvListQuery = PageQuery.extend({ kind: EnvKind });
export type EnvListQuery = z.infer<typeof EnvListQuery>;

export const CreateEnvVarRequest = z.object({ name: EnvName, value: EnvVarValue });
export type CreateEnvVarRequest = z.infer<typeof CreateEnvVarRequest>;
export const CreateEnvSecretRequest = z.object({ name: EnvName, value: EnvSecretValue });
export type CreateEnvSecretRequest = z.infer<typeof CreateEnvSecretRequest>;
export const UpdateEnvVarRequest = z.object({ value: EnvVarValue });
export type UpdateEnvVarRequest = z.infer<typeof UpdateEnvVarRequest>;
export const UpdateEnvSecretRequest = z.object({ value: EnvSecretValue });
export type UpdateEnvSecretRequest = z.infer<typeof UpdateEnvSecretRequest>;
