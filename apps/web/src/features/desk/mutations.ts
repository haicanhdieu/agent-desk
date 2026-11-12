import type { CreateRuleRequest, RuleDto, UpdateRuleRequest } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useToast } from '@/ds';
import { api } from '../api';
import { deskQueries } from './queries';

// Skill commit and delete (spec §4.3): no optimistic update; the affected desk keys are invalidated on success.

export const STALE_SKILL_TOAST = 'Skill changed elsewhere — reload';

/** A 409 on a skill commit: the sha we sent is no longer the skill's current one. */
export const isStaleSkill = (e: unknown): boolean => e instanceof ApiError && e.status === 409;

export interface CommitSkillInput {
  name: string;
  body: string;
  message: string;
  /** The sha the edit started from; the server refuses the commit when the skill moved on since. */
  sha: string;
}

export function useCommitSkill(org: string, projectId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ name, body, message, sha }: CommitSkillInput) =>
      api.skills.put({ params: { projectId, name }, body: { body, message, sha } }),
    onSuccess: async (_res, { name }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: deskQueries.skills(org, projectId).queryKey }),
        qc.invalidateQueries({ queryKey: deskQueries.skill(org, projectId, name).queryKey }),
      ]);
    },
    onError: async (e, { name }) => {
      if (!isStaleSkill(e)) return;
      toast.show({ tone: 'err', title: STALE_SKILL_TOAST });
      await qc.invalidateQueries({ queryKey: deskQueries.skill(org, projectId, name).queryKey });
    },
  });
}

export function useDeleteSkill(org: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, message }: { name: string; message: string }) =>
      api.skills.remove({ params: { projectId, name }, query: { message } }),
    onSuccess: async (_res, { name }) => {
      // The deleted skill is only marked stale: refetching it now would 404 while the page still shows it.
      await Promise.all([
        qc.invalidateQueries({ queryKey: deskQueries.skills(org, projectId).queryKey }),
        qc.invalidateQueries({ queryKey: deskQueries.skill(org, projectId, name).queryKey, refetchType: 'none' }),
      ]);
    },
  });
}

// Rules (spec §4.3): the enable toggle is optimistic on the rules cache; create, edit and delete invalidate it.

/** Per-rule toggle bookkeeping: the newest request, how many are in flight, and the last state the server confirmed. */
interface ToggleTrack {
  latest: number;
  pending: number;
  confirmed: boolean;
  /** The request whose answer set `confirmed` (0: the cached state before any toggle); older answers are stale. */
  confirmedBy: number;
}

/**
 * Enable or disable a rule. The rule's row flips at once. Each answer only touches its own rule, and only when it is
 * still the newest request for that rule, or the last one to settle: then the row shows what the server confirmed.
 * So a late failure of rule A never reverts rule B, and a stale answer never overwrites a newer flip of the same
 * rule. `onError` tells the user (an error toast); as a hook option it fires for every failed toggle.
 */
export function useToggleRule(org: string, projectId: string, { onError }: { onError?(e: unknown): void } = {}) {
  const qc = useQueryClient();
  const queryKey = deskQueries.rules(org, projectId).queryKey;
  const tracks = useRef(new Map<string, ToggleTrack>());
  const seq = useRef(0);
  const setEnabled = (id: string, enabled: boolean) =>
    qc.setQueryData(queryKey, (rules) => rules?.map((r) => (r.id === id ? { ...r, enabled } : r)));
  /** Called when a request settles; shows `value` if it is the newest request, else the confirmed state once idle. */
  const settle = (id: string, n: number, value: (t: ToggleTrack) => boolean) => {
    const t = tracks.current.get(id);
    if (!t) return;
    t.pending -= 1;
    if (n === t.latest || t.pending === 0) setEnabled(id, n === t.latest ? value(t) : t.confirmed);
    if (t.pending === 0) tracks.current.delete(id);
  };
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.rules.update({ params: { ruleId: id }, body: { enabled } }),
    onMutate: async ({ id, enabled }) => {
      const n = ++seq.current;
      const current = qc.getQueryData(queryKey)?.find((r) => r.id === id)?.enabled ?? !enabled;
      const t = tracks.current.get(id) ?? { latest: n, pending: 0, confirmed: current, confirmedBy: 0 };
      t.latest = n;
      t.pending += 1;
      tracks.current.set(id, t);
      await qc.cancelQueries({ queryKey });
      setEnabled(id, enabled);
      return { id, n };
    },
    onSuccess: (saved, _vars, { id, n }) => {
      const t = tracks.current.get(id);
      if (t && n > t.confirmedBy) Object.assign(t, { confirmed: saved.enabled, confirmedBy: n });
      settle(id, n, () => saved.enabled);
    },
    onError: (e, _vars, context) => {
      if (context) settle(context.id, context.n, (t) => t.confirmed);
      onError?.(e);
    },
  });
}

export type SaveRuleInput = { id?: undefined; body: CreateRuleRequest } | { id: string; body: UpdateRuleRequest };

/** Creates a rule (no `id`) or updates one; the rules list refetches on success. */
export function useSaveRule(org: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveRuleInput): Promise<RuleDto> =>
      input.id === undefined
        ? api.rules.create({ params: { projectId }, body: input.body })
        : api.rules.update({ params: { ruleId: input.id }, body: input.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: deskQueries.rules(org, projectId).queryKey }),
  });
}

export function useDeleteRule(org: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rules.remove({ params: { ruleId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: deskQueries.rules(org, projectId).queryKey }),
  });
}
