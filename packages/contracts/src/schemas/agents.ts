import { z } from 'zod';
import { AgentKind, CredentialType } from '../enums';
import { isBlockedIp } from '../net';
import { Id, Timestamp } from './common';

const AGENT_MODEL_ID_MESSAGE = 'Use 1 to 200 letters, digits or . _ : / @ [ ] + -, starting with a letter or digit.';
const AGENT_BASE_URL_MESSAGE =
  'Use a public https address with no username, password, query or fragment, up to 2048 characters.';

export const AgentDto = z.object({
  id: Id,
  projectId: Id,
  name: z.string(),
  provider: AgentKind,
  /** The default model. */
  model: z.string(),
  /** Custom API address, or null for the provider's own. */
  baseUrl: z.string().nullable(),
  maxTurns: z.number().int().nullable(),
  timeoutSeconds: z.number().int(),
  pausedKeepSeconds: z.number().int(),
  doneKeepSeconds: z.number().int(),
  idleEndSeconds: z.number().int(),
  autoResumeMax: z.number().int(),
  credential: z.object({
    set: z.boolean(),
    type: CredentialType.nullable(),
    updatedAt: Timestamp.nullable(),
    setBy: z.string().nullable(),
  }),
});
export type AgentDto = z.infer<typeof AgentDto>;

/** Run time limit bounds, seconds (ADR 0021): at least a minute, at most 7 days; new agents get 24 h. */
export const AGENT_TIMEOUT_SECONDS_MIN = 60;
export const AGENT_TIMEOUT_SECONDS_MAX = 604800;
export const AGENT_TIMEOUT_SECONDS_DEFAULT = 86400;

/** How long a paused run can be resumed, seconds (ADR 0022): 1 hour to 30 days, default 7 days. */
export const AGENT_PAUSED_KEEP_SECONDS_MIN = 3600;
export const AGENT_PAUSED_KEEP_SECONDS_MAX = 2592000;
export const AGENT_PAUSED_KEEP_SECONDS_DEFAULT = 604800;

/** How long a succeeded run's session can be re-opened, seconds (ADR 0022): 0 (not kept) to 7 days, default 1 day. */
export const AGENT_DONE_KEEP_SECONDS_MIN = 0;
export const AGENT_DONE_KEEP_SECONDS_MAX = 604800;
export const AGENT_DONE_KEEP_SECONDS_DEFAULT = 86400;

/** How long a run may sit idle with no terminal attached before it pauses, seconds: 5 minutes to 7 days, default 30 minutes. */
export const AGENT_IDLE_END_SECONDS_MIN = 300;
export const AGENT_IDLE_END_SECONDS_MAX = 604800;
export const AGENT_IDLE_END_SECONDS_DEFAULT = 1800;
/** Automatic resumes after an unexpected pod end, in a row (spec 2026-11-20): 0 (off) to 10, default 5. */
export const AGENT_AUTO_RESUME_MAX_MIN = 0;
export const AGENT_AUTO_RESUME_MAX_MAX = 10;
export const AGENT_AUTO_RESUME_MAX_DEFAULT = 5;

export const AGENT_MODEL_ID_MAX = 200;
export const AgentModelId = z
  .string()
  .trim()
  // The pattern carries the 1..200 length, so a bad value yields one message.
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@[\]+-]{0,199}$/, { message: AGENT_MODEL_ID_MESSAGE });

export const AGENT_BASE_URL_MAX = 2048;

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/** A public https address: no credentials, query or fragment, no localhost, no private or loopback IP literal. */
export function isAllowedAgentBaseUrl(raw: string): boolean {
  // Lowercase scheme; printable ASCII only (no whitespace, backslash, control or non-ASCII character) anywhere: the WHATWG parser would
  // normalise or strip those, but the raw string is what is stored and printed.
  if (hasControlChar(raw) || !/^https:\/\/[\x21-\x5b\x5d-\x7e]*$/.test(raw) || raw.includes('?') || raw.includes('#'))
    return false;
  // The host as typed (not url.hostname, which decodes %41 and keeps a+b): only the characters the runner's launch line
  // prints (letters, digits . _ - or a bracketed IPv6 literal), so the contract and the launch line agree on a host.
  const rawHost = raw.slice('https://'.length).split('/')[0].replace(/:\d+$/, '');
  if (!/^([A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])$/.test(rawHost)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  return !isBlockedIp(host.replace(/^\[|\]$/g, ''));
}

export const AgentBaseUrl = z
  .string()
  .trim()
  .max(AGENT_BASE_URL_MAX, { message: AGENT_BASE_URL_MESSAGE })
  .refine(isAllowedAgentBaseUrl, { message: AGENT_BASE_URL_MESSAGE });

export const AgentModelOption = z.object({ id: z.string(), label: z.string() });
export type AgentModelOption = z.infer<typeof AgentModelOption>;

export const AgentModelsReason = z.enum(['no_credential', 'unreachable', 'rejected', 'empty', 'disabled']);
export type AgentModelsReason = z.infer<typeof AgentModelsReason>;

export const AgentModelsDto = z.object({
  source: z.enum(['live', 'builtin']),
  reason: AgentModelsReason.nullable(),
  models: z.array(AgentModelOption),
});
export type AgentModelsDto = z.infer<typeof AgentModelsDto>;

export const PutAgentRequest = z.object({
  model: AgentModelId,
  maxTurns: z.number().int().min(1).optional(),
  timeoutSeconds: z
    .number()
    .int()
    .min(AGENT_TIMEOUT_SECONDS_MIN, { message: 'The run time limit must be at least 1 minute' })
    .max(AGENT_TIMEOUT_SECONDS_MAX, { message: 'The run time limit can be at most 7 days' }),
  /** Absent keeps the stored value. */
  pausedKeepSeconds: z
    .number()
    .int()
    .min(AGENT_PAUSED_KEEP_SECONDS_MIN, { message: 'A paused run must be kept between 1 hour and 30 days' })
    .max(AGENT_PAUSED_KEEP_SECONDS_MAX, { message: 'A paused run must be kept between 1 hour and 30 days' })
    .optional(),
  /** Absent keeps the stored value. */
  doneKeepSeconds: z
    .number()
    .int()
    .min(AGENT_DONE_KEEP_SECONDS_MIN, { message: "A finished run's session can be kept for at most 7 days" })
    .max(AGENT_DONE_KEEP_SECONDS_MAX, { message: "A finished run's session can be kept for at most 7 days" })
    .optional(),
  /** Absent keeps the stored value. */
  idleEndSeconds: z
    .number()
    .int()
    .min(AGENT_IDLE_END_SECONDS_MIN, { message: 'Idle runs must end after between 5 minutes and 7 days' })
    .max(AGENT_IDLE_END_SECONDS_MAX, { message: 'Idle runs must end after between 5 minutes and 7 days' })
    .optional(),
  /** Absent keeps the stored value. */
  autoResumeMax: z
    .number()
    .int()
    .min(AGENT_AUTO_RESUME_MAX_MIN, { message: 'Automatic resumes must be between 0 and 10' })
    .max(AGENT_AUTO_RESUME_MAX_MAX, { message: 'Automatic resumes must be between 0 and 10' })
    .optional(),
});
export type PutAgentRequest = z.infer<typeof PutAgentRequest>;

export const PutCredentialRequest = z.object({
  type: CredentialType,
  value: z.string().min(1),
  /** Absent keeps the saved address, a value sets it, null clears it. */
  baseUrl: AgentBaseUrl.nullable().optional(),
});
export type PutCredentialRequest = z.infer<typeof PutCredentialRequest>;

export const PutCredentialResponse = z.object({ updatedAt: Timestamp });
export type PutCredentialResponse = z.infer<typeof PutCredentialResponse>;
