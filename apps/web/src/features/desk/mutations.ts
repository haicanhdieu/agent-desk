import type { CreateRuleRequest, RuleDto, UpdateRuleRequest } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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

/**
 * Enable or disable a rule. The rules cache flips at once and rolls back when the server refuses; `onError` then
 * tells the user (an error toast). It is a hook option, not a `mutate` option, so it fires for every failed toggle.
 */
export function useToggleRule(org: string, projectId: string, { onError }: { onError?(e: unknown): void } = {}) {
  const qc = useQueryClient();
  const queryKey = deskQueries.rules(org, projectId).queryKey;
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.rules.update({ params: { ruleId: id }, body: { enabled } }),
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData(queryKey);
      qc.setQueryData(queryKey, (rules) => rules?.map((r) => (r.id === id ? { ...r, enabled } : r)));
      return { previous };
    },
    onError: (e, _vars, context) => {
      if (context?.previous) qc.setQueryData(queryKey, context.previous);
      onError?.(e);
    },
    // The server's rule replaces the optimistic one; no refetch, so a failure shows only the rollback.
    onSuccess: (saved) => qc.setQueryData(queryKey, (rules) => rules?.map((r) => (r.id === saved.id ? saved : r))),
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
