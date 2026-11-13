import { z } from 'zod';
import { Id, Timestamp } from './common';

export const SETUP_SCRIPT_MAX_BYTES = 65536;

/** The limit is in UTF-8 bytes (matches the DB `octet_length` check), not characters. */
export const SetupScriptBody = z
  .string()
  .refine((s) => new TextEncoder().encode(s).length <= SETUP_SCRIPT_MAX_BYTES, 'Setup script is larger than 64 KiB');
export type SetupScriptBody = z.infer<typeof SetupScriptBody>;

export const SetupScriptVersionDto = z.object({
  version: z.number().int().min(1),
  note: z.string().nullable(),
  /** User handle. */
  createdBy: z.string(),
  createdAt: Timestamp,
});
export type SetupScriptVersionDto = z.infer<typeof SetupScriptVersionDto>;

export const SetupScriptDto = SetupScriptVersionDto.extend({ body: z.string() });
export type SetupScriptDto = z.infer<typeof SetupScriptDto>;

export const PutSetupScriptRequest = z.object({
  body: SetupScriptBody,
  note: z.string().max(200).optional(),
  /** Version the editor loaded (null when none existed); a mismatch is a conflict. */
  baseVersion: z.number().int().min(1).nullable(),
});
export type PutSetupScriptRequest = z.infer<typeof PutSetupScriptRequest>;

export const SetupTestStatus = z.enum(['queued', 'running', 'passed', 'failed', 'ended']);
export type SetupTestStatus = z.infer<typeof SetupTestStatus>;

export const SetupTestPlugins = z.object({
  installed: z.array(z.string()),
  skipped: z.array(z.string()),
  failed: z.array(z.string()),
});
export type SetupTestPlugins = z.infer<typeof SetupTestPlugins>;

/** A setup test. The script text is never part of it, only its hash. */
export const SetupTestDto = z.object({
  id: Id,
  projectId: Id,
  status: SetupTestStatus,
  scriptSha256: z.string(),
  /** The tested script is still the project's current script. */
  matchesCurrentScript: z.boolean(),
  checkoutSha: z.string().nullable(),
  plugins: SetupTestPlugins,
  exitCode: z.number().int().nullable(),
  /** User handle. */
  startedBy: z.string(),
  createdAt: Timestamp,
  finishedAt: Timestamp.nullable(),
  endedAt: Timestamp.nullable(),
  /** When the workspace is deleted on its own; null once ended or before the setup result is known. */
  endsAt: Timestamp.nullable(),
});
export type SetupTestDto = z.infer<typeof SetupTestDto>;

export const CreateSetupTestRequest = z.object({ script: SetupScriptBody });
export type CreateSetupTestRequest = z.infer<typeof CreateSetupTestRequest>;

export const PluginState = z.enum(['will_install', 'blocked']);
export type PluginState = z.infer<typeof PluginState>;

/**
 * What the runner will do with the plugins the repo's `.claude/settings.json` enables. `id` is `plugin@store`.
 * `blocked` plugins come from a store that is not approved. `settingsError` is set when the file could not be read.
 */
export const PluginsDto = z.object({
  /** Names of the approved plugin stores (never their sources). */
  approvedStores: z.array(z.string()),
  plugins: z.array(z.object({ id: z.string(), name: z.string(), store: z.string(), state: PluginState })),
  settingsError: z.enum(['unreadable']).nullable(),
});
export type PluginsDto = z.infer<typeof PluginsDto>;
