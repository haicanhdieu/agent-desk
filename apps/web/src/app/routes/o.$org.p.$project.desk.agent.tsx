import { ApiError } from '@agentdesk/contracts/client';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { toastFromError } from '@/app/boundaries';
import { useNow } from '@/app/useNow';
import { useToast } from '@/ds';
import { limitsOf, toAgentSettings, useReplaceCredential, useSaveLimits } from '@/features/desk/agent.form';
import { useDeskFrame } from '@/features/desk/frame';
import { forgetProject, useDeleteProject, useSaveTrigger } from '@/features/desk/mutations';
import { deskQueries } from '@/features/desk/queries';
import { pollIntervalLabel } from '@/features/projects/map';
import { projectsQueries } from '@/features/projects/queries';
import { lastEvent, pollSeconds } from '@/features/setup/map';
import { connectionCopy } from '@/mocks/connection';
import type { PollInterval, TriggerMode } from '@/mocks/types';
import { DeskAgent } from '@/screens';

export const Route = createFileRoute('/o/$org/p/$project/desk/agent')({
  loader: ({ context: { queryClient }, params: { org, project } }) =>
    queryClient.ensureQueryData(deskQueries.agent(org, project)),
  component: DeskAgentPage,
});

type Trigger = { mode: TriggerMode; interval: PollInterval };

function DeskAgentPage() {
  const { org, project: projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const frame = useDeskFrame(org, projectId, now);
  const { data: project } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: connection } = useSuspenseQuery(projectsQueries.connection(org, projectId));
  const { data: agent } = useSuspenseQuery(deskQueries.agent(org, projectId));

  const limits = useSaveLimits(org, projectId, limitsOf(agent, project), {
    onSaved: () => toast.show({ tone: 'ok', title: 'Limits saved' }),
  });
  const credential = useReplaceCredential(org, projectId, agent.id);

  // Trigger mode: the pick shows at once and is saved; while saves are in flight the latest pick shows, after a
  // failure the saved mode shows again with the problem title (spec §6). Every save settles through its own promise;
  // only the latest pick's outcome is shown, so an older save failing late never hides a newer pick.
  const saveTrigger = useSaveTrigger(org, projectId);
  const triggerSeq = useRef(0);
  const [picked, setPicked] = useState<Trigger>();
  const [triggerError, setTriggerError] = useState<string>();
  const onTriggerChange = (next: Trigger) => {
    const n = ++triggerSeq.current;
    setPicked(next);
    setTriggerError(undefined);
    const settle = (e?: unknown) => {
      if (n !== triggerSeq.current) return;
      setPicked(undefined);
      if (e !== undefined) setTriggerError(e instanceof ApiError ? e.title : 'Something went wrong. Try again.');
    };
    void saveTrigger
      .mutateAsync({
        triggerMode: next.mode,
        ...(next.mode === 'polling' && { pollIntervalSeconds: pollSeconds(next.interval) }),
      })
      .then(() => settle(), settle);
  };

  const remove = useDeleteProject(org, projectId);
  const deleting = useRef(false);
  const onDeleteProject = () => {
    if (deleting.current) return;
    deleting.current = true;
    remove.mutate(undefined, {
      onSuccess: async () => {
        await navigate({ to: '/o/$org/projects', params: { org } });
        forgetProject(qc, org, projectId);
      },
      onError: (e) => toast.show(toastFromError(e)),
      onSettled: () => {
        deleting.current = false;
      },
    });
  };

  const heard = lastEvent(connection, now);
  const github = [
    { term: 'Repository', value: <span className="mono">{project.repoPath}</span> },
    {
      term: heard.mode === 'webhook' ? connectionCopy.lastEventTerm : connectionCopy.lastCheckedTerm,
      value: `${heard.at} (${heard.mode})`,
    },
  ];
  const saved: Trigger = { mode: project.triggerMode, interval: pollIntervalLabel(project.pollIntervalSeconds) };

  return (
    <DeskAgent
      frame={frame}
      settings={toAgentSettings(agent, project, now)}
      github={github}
      trigger={picked ?? saved}
      pollInterval={saved.interval}
      onTriggerChange={onTriggerChange}
      triggerError={triggerError}
      onSaveLimits={(next) => void limits.save(next)}
      limitsErrors={limits.errors}
      limitsError={limits.formError}
      savingLimits={limits.saving}
      idleReadOnly
      onReplaceCredential={credential.replace}
      credentialError={credential.error}
      onDeleteProject={onDeleteProject}
    />
  );
}
