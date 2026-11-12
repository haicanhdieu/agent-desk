import { ApiError } from '@agentdesk/contracts/client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { lazy, Suspense, useCallback, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { toastFromError } from '@/app/boundaries';
import { useNow } from '@/app/useNow';
import type { LiveTerminalHandle } from '@/components/LiveTerminal';
import { Banner, Skeleton, useToast } from '@/ds';
import {
  scrollbackLines,
  scrollbackText,
  streamConnection,
  terminalConnection,
  toRunDetail,
} from '@/features/runs/detail.map';
import { isFinal } from '@/features/runs/map';
import { useCancelRun, useFinishRun } from '@/features/runs/mutations';
import { useProjectPage } from '@/features/runs/page';
import { runsQueries } from '@/features/runs/queries';
import { useFinalLogReload, useRunEvents } from '@/features/runs/useRunEvents';
import { useTerminal } from '@/features/runs/useTerminal';
import { RunDetail } from '@/screens';

// xterm downloads only when a run detail shows a terminal (spec §5.3).
const LiveTerminal = lazy(() => import('@/components/LiveTerminal'));

const GAVE_UP_BODY = 'The agent keeps working; tmux holds the session. Reconnect to attach to the terminal again.';

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
  // Turned final while open: the run and its log (the final scrollback) reload.
  useFinalLogReload(org, projectId, number, final);
  // The live terminal, while the run is running or idle. The socket opens once the (lazy) terminal has mounted, so
  // no output arrives before there is a terminal to write it to.
  const live = dto.status === 'running' || dto.status === 'idle';
  const termRef = useRef<LiveTerminalHandle | null>(null);
  const [termReady, setTermReady] = useState(false);
  const attachTerm = useCallback((handle: LiveTerminalHandle | null) => {
    termRef.current = handle;
    if (handle) setTermReady(true);
  }, []);
  const term = useTerminal(dto.id, live && termReady, termRef, { org, projectId, number });
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const onError = (e: unknown) => toast.show(toastFromError(e));
  const cancel = useCancelRun(org, projectId, { onError });
  const finish = useFinishRun(org, projectId, { onError });

  const { paths } = page;
  const target = { id: dto.id, number };
  const mapped = toRunDetail(dto, events, page.dto, ticketRuns.items, now, { runs: paths.runs, agent: paths.agent });
  const data = final
    ? mapped
    : { ...mapped, connection: live ? terminalConnection(term.state, stream) : streamConnection(stream) };
  // A finished run's stored scrollback in the same terminal, read-only, written once.
  const scrollback = final ? scrollbackText(events) : undefined;
  // Keyed by the scrollback event too, so a later (re-stored) scrollback opens a new terminal with it.
  const scrollbackSeq = events.filter((e) => e.type === 'scrollback').at(-1)?.seq;
  let terminal: ReactNode;
  if (live && term.state === 'forbidden') {
    terminal = <Banner tone="err" flush live="polite" title="You can't open this terminal" />;
  } else if (live) {
    terminal = (
      <Suspense fallback={<TerminalLoading />}>
        <LiveTerminal key={`live:${dto.id}`} ref={attachTerm} onData={term.onData} onResize={term.onResize} />
      </Suspense>
    );
  } else if (scrollback !== undefined) {
    terminal = (
      <Suspense fallback={<TerminalLoading />}>
        <LiveTerminal key={`final:${dto.id}:${scrollbackSeq}`} ref={attachTerm} readOnly initial={scrollback} />
      </Suspense>
    );
  }
  const ticket = `${dto.ticket.kind === 'pr' ? 'PR' : 'issue'} #${dto.ticket.number}`;

  return (
    <RunDetail
      data={data}
      lines={final ? scrollbackLines(events) : undefined}
      terminal={terminal}
      // The "terminal lost" overlay belongs to a live terminal that gave up; never to queued, starting or final runs.
      onReconnect={live ? term.reconnect : undefined}
      reconnectOverlay={live && term.state === 'gave_up'}
      reconnectBody={live ? GAVE_UP_BODY : undefined}
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

function TerminalLoading() {
  return (
    <div aria-busy="true" aria-label="Loading the terminal" role="status">
      <Skeleton variant="text" lines={6} width="100%" />
    </div>
  );
}
