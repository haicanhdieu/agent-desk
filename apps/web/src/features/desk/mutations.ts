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
