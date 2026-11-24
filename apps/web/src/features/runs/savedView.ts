import { RUN_SEARCH_MAX, RunListFilter } from '@agentdesk/contracts';
import { z } from 'zod';

/**
 * The part of the Runs page's URL that a person chooses: `filter` is a run list filter or `ignored` (anything else
 * falls back to all); `q` is the search text (trimmed; empty or too long is no search).
 */
export const RunsView = z.object({
  filter: z
    .enum([...RunListFilter.options, 'ignored'])
    .optional()
    .catch(undefined),
  q: z
    .string()
    .trim()
    .max(RUN_SEARCH_MAX)
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .catch(undefined),
});
export type RunsView = z.infer<typeof RunsView>;

/** Where one project's Runs page keeps its last filter and search, per browser (like the page size and grouping). */
export const runsViewStorageKey = (org: string, projectId: string): string => `agentdesk.runs.view:${org}:${projectId}`;

/** The saved filter and search; a missing, blocked, unreadable or unexpected value means none. */
export function readSavedView(org: string, projectId: string): RunsView {
  try {
    const raw = localStorage.getItem(runsViewStorageKey(org, projectId));
    if (raw === null) return {};
    return RunsView.parse(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

/** Saves the filter and search on show; with neither (all, no search) the saved view is dropped. Storage can be blocked or full. */
export function writeSavedView(org: string, projectId: string, view: RunsView): void {
  try {
    const key = runsViewStorageKey(org, projectId);
    if (view.filter === undefined && view.q === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(view));
  } catch {
    // Not saved; the page still works for this visit.
  }
}
