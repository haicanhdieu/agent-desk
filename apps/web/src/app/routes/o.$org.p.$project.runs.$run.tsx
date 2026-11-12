import { ApiError } from '@agentdesk/contracts/client';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { toastFromError } from '@/app/boundaries';
import { useNow } from '@/app/useNow';
import { useToast } from '@/ds';
import { scrollbackLines, streamConnection, toRunDetail } from '@/features/runs/detail.map';
import { isFinal } from '@/features/runs/map';
import { useCancelRun, useFinishRun } from '@/features/runs/mutations';
import { useProjectPage } from '@/features/runs/page';
import { runsQueries } from '@/features/runs/queries';
import { useRunEvents } from '@/features/runs/useRunEvents';
import { RunDetail } from '@/screens';

/** `$run` is the per-project run number. */
const RunParam = z.string().regex(/^[1-9]\d{0,8}$/);

export const Route = createFileRoute('/o/$org/p/$project/runs/$run')({
  beforeLoad: ({ params }) => {
    if (!RunParam.safeParse(params.run).success) throw notFound();
  },
  loader: async ({ context: { queryClient }, params: { org, project, run } }) => {
    const number = Number(run);
    // An unknown number, or another org's run (the API answers 404), is not found.
    const dto = await queryClient.ensureQueryData(runsQueries.detail(org, project, number)).catch((e: unknown) => {
      throw e instanceof ApiError && e.status === 404 ? notFound() : e;
    });
    await Promise.all([
      queryClient.ensureQueryData(runsQueries.events(org, project, number, isFinal(dto.status))),
      // The chain: every run on the same ticket.
      queryClient.ensureQueryData(runsQueries.list(org, project, 'all', dto.ticket.ref)),
    ]);
  },
  component: RunDetailRoute,
});

function RunDetailRoute() {
  const { org, project: projectId, run } = Route.useParams();
  const number = Number(run);
  const now = useNow();
  const toast = useToast();
  const page = useProjectPage(org, projectId, now);
  const { data: dto } = useSuspenseQuery(runsQueries.detail(org, projectId, number));
  const final = isFinal(dto.status);
  const { data: events } = useSuspenseQuery(runsQueries.events(org, projectId, number, final));
  const { data: ticketRuns } = useSuspenseQuery(runsQueries.list(org, projectId, 'all', dto.ticket.ref));
  // Live status and log while the run is not final (spec §5.1).
  const stream = useRunEvents(org, projectId, number, dto.id, !final);
  const queryClient = useQueryClient();
  // The run became final while open (a refetch, not loaded final): its log now has the final scrollback.
  const wasFinal = useRef(final);
  useEffect(() => {
    if (final && !wasFinal.current) {
      void queryClient.invalidateQueries({ queryKey: runsQueries.events(org, projectId, number).queryKey });
    }
    wasFinal.current = final;
  }, [final, queryClient, org, projectId, number]);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const onError = (e: unknown) => toast.show(toastFromError(e));
  const cancel = useCancelRun(org, projectId, { onError });
  const finish = useFinishRun(org, projectId, { onError });

  const { paths } = page;
  const target = { id: dto.id, number };
  const mapped = toRunDetail(dto, events, page.dto, ticketRuns.items, now, { runs: paths.runs, agent: paths.agent });
  const data = final ? mapped : { ...mapped, connection: streamConnection(stream) };
  const ticket = `${dto.ticket.kind === 'pr' ? 'PR' : 'issue'} #${dto.ticket.number}`;

  return (
    <RunDetail
      data={data}
      lines={final ? scrollbackLines(events) : undefined}
      needsYou={page.dto.counts.needsYou}
      projectName={page.dto.name}
      links={{ projects: paths.projects, runs: paths.runs, skills: paths.skills, rules: paths.rules }}
      pendingNote={dto.statusNote}
      panelCollapsed={panelCollapsed}
      onTogglePanel={() => setPanelCollapsed((c) => !c)}
      cancelConfirmOpen={confirmingCancel && !final}
      cancelBody={
        <>
          The pod is stopped now. Work the agent has not pushed is lost. A &quot;cancelled&quot; comment is posted on{' '}
          {ticket}.
        </>
      }
      onCancel={() => setConfirmingCancel(true)}
      onCancelClose={() => setConfirmingCancel(false)}
      onCancelConfirm={() => {
        setConfirmingCancel(false);
        cancel(target);
      }}
      onFinish={() => finish(target)}
    />
  );
}
