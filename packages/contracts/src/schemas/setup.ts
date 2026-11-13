import { z } from 'zod';
import { Timestamp } from './common';

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
