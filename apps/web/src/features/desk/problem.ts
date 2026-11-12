import { ApiError } from '@agentdesk/contracts/client';

export interface ProblemErrors {
  fields: Record<string, string>;
  form?: string;
}

export const GENERIC_FORM_ERROR = 'Something went wrong. Try again.';

/** The field a JSON Pointer names: the pointer itself, else its first segment (`/labelFilter/0` → `/labelFilter`). */
function fieldOf(pointer: string, map: Record<string, string>): string | undefined {
  return map[pointer] ?? map[`/${pointer.split('/')[1] ?? ''}`];
}

/**
 * Spreads a problem+json error over a form (spec §4.3, §6): each `errors[]` JSON Pointer that `map` knows becomes that
 * field's message (the first one wins). Unmapped pointers, an ApiError without field errors, and anything that is
 * not an ApiError become the form-level message.
 */
export function fieldErrorsFromProblem(e: unknown, map: Record<string, string>): ProblemErrors {
  if (!(e instanceof ApiError)) return { fields: {}, form: GENERIC_FORM_ERROR };
  const fields: Record<string, string> = {};
  const unmapped: string[] = [];
  for (const err of e.errors ?? []) {
    const field = fieldOf(err.pointer, map);
    if (field === undefined) unmapped.push(err.detail);
    else fields[field] ??= err.detail;
  }
  if (Object.keys(fields).length > 0 && unmapped.length === 0) return { fields };
  return { fields, form: [e.detail ?? e.title, ...unmapped].join(' ') };
}
