import { z } from 'zod';
import { Timestamp } from './common';

export const TRANSCRIPT_TEXT_MAX_BYTES = 8000;
export const TRANSCRIPT_WIRE_MAX_BASE64 = 12000;
export const TRANSCRIPT_ENTRY_CAP = 20000;
export const TRANSCRIPT_LIMIT_NOTICE = 'Transcript limit reached; later messages were not saved';

export const TranscriptKind = z.enum(['user', 'agent', 'tool', 'notice']);
export type TranscriptKind = z.infer<typeof TranscriptKind>;

/** One entry of the agent-neutral transcript wire line (`agentdesk: transcript <base64 JSON>`). */
export const TranscriptWireEntry = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    at: Timestamp.optional(),
    kind: TranscriptKind,
    text: z.string().refine((s) => new TextEncoder().encode(s).length <= TRANSCRIPT_TEXT_MAX_BYTES, {
      message: `text must be at most ${TRANSCRIPT_TEXT_MAX_BYTES} UTF-8 bytes`,
    }),
    tool: z.string().min(1).max(64).optional(),
    truncated: z.boolean().optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.tool !== undefined && entry.kind !== 'tool') {
      ctx.addIssue({ code: 'custom', path: ['tool'], message: 'tool is only allowed for kind tool' });
    }
  });
export type TranscriptWireEntry = z.infer<typeof TranscriptWireEntry>;

export const RunTranscriptEntryDto = z.object({
  seq: z.number().int(),
  at: Timestamp,
  kind: TranscriptKind,
  tool: z.string().nullable(),
  text: z.string(),
  truncated: z.boolean(),
});
export type RunTranscriptEntryDto = z.infer<typeof RunTranscriptEntryDto>;

export const RunTranscriptQuery = z.object({
  before: z.coerce.number().int().min(1).max(2147483647).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type RunTranscriptQuery = z.infer<typeof RunTranscriptQuery>;

export const RunTranscriptResponse = z.object({
  items: z.array(RunTranscriptEntryDto),
  nextBefore: z.number().int().nullable(),
});
export type RunTranscriptResponse = z.infer<typeof RunTranscriptResponse>;
