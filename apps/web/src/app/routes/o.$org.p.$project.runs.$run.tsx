import { can } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { lazy, Suspense, useCallback, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { toastFromError } from '@/app/boundaries';
import { WHOLE_SET } from '@/app/pagination';
import { useNow } from '@/app/useNow';
import type { TerminalKey, TranscriptProps } from '@/components';
import type { LiveTerminalHandle } from '@/components/LiveTerminal';
import { BELOW_DESKTOP, Banner, Skeleton, useMediaQuery, useToast } from '@/ds';
import { useAccess } from '@/features/access/guards';
import {
  scrollbackLines,
  scrollbackText,
  streamConnection,
  terminalArea,
  terminalConnection,
  toRunDetail,
  withDetailPrStates,
} from '@/features/runs/detail.map';
import { isFinal, prRefsOf } from '@/features/runs/map';
import { useCancelRun, useCloseSession, useFinishRun, useResumeRun, useStopRun } from '@/features/runs/mutations';
import { useProjectPage } from '@/features/runs/page';
import { runsQueries, usePrStates } from '@/features/runs/queries';
import { transcriptConnection, transcriptItems, useTranscriptReload } from '@/features/runs/transcript';
import { useFinalLogReload, useRunEvents } from '@/features/runs/useRunEvents';
import { useTerminal } from '@/features/runs/useTerminal';
import { useVisualViewportHeight } from '@/features/runs/useVisualViewportHeight';
import { TERMINAL_UNUSED_CLOSE_MS } from '@/features/runs/unusedWatch';
import { RunDetail } from '@/screens';

// xterm downloads only when a run detail shows a terminal (spec §5.3).
const LiveTerminal = lazy(() => import('@/components/LiveTerminal'));

const GAVE_UP_BODY = 'The agent keeps working; tmux holds the session. Reconnect to attach to the terminal again.';

const UNUSED_HOURS = TERMINAL_UNUSED_CLOSE_MS / (60 * 60 * 1000);
const INACTIVE_BODY = `Nobody used this page for ${UNUSED_HOURS} hours, so the terminal was closed and the run can pause when it is idle. The agent keeps working; tmux holds the session. Reconnect to attach to the terminal again.`;

/** `$run` is the per-project run number. */
const RunParam = z.string().regex(/^[1-9]\d{0,8}$/);

export const Route = createFileRoute('/o/$org/p/$project/runs/$run')({
  staticData: {
    chrome: { mode: 'standard', scope: 'project', item: 'runs', parent: true, fill: true, startCollapsed: true },
  },
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
      queryClient.ensureQueryData(
        runsQueries.list(org, project, { filter: 'all', ticket: dto.ticket.ref, ...WHOLE_SET }),
      ),
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
  const { data: ticketRuns } = useSuspenseQuery(
    runsQueries.list(org, projectId, { filter: 'all', ticket: dto.ticket.ref, ...WHOLE_SET }),
  );
  // The PR's live state: a separate, non-blocking request in the component (never the loader); neutral until it lands.
  // The ticket's linked tickets come with this run's entry in the list; their PRs are asked for too.
  const linkedTickets = ticketRuns.items.find((r) => r.id === dto.id)?.linkedTickets ?? [];
  const prStates = usePrStates(org, projectId, prRefsOf([dto.ticket, ...linkedTickets]));
  // Live status and log while the run is not final (spec §5.1).
  const stream = useRunEvents(org, projectId, number, dto.id, !final);
  // Turned final while open: the run and its log (the final scrollback) reload.
  useFinalLogReload(org, projectId, number, final);
  // The live terminal, while the run is running or idle and its session is not ending (then the page says "Pausing"
  // and opens no socket; the run stream brings the park). The socket opens once the (lazy) terminal has mounted, so
  // no output arrives before there is a terminal to write it to.
  const area = terminalArea(dto, events);
  const live = area === 'live';
  const pausing = area === 'pausing';
  const termRef = useRef<LiveTerminalHandle | null>(null);
  const [termReady, setTermReady] = useState(false);
  const attachTerm = useCallback((handle: LiveTerminalHandle | null) => {
    termRef.current = handle;
    if (handle) setTermReady(true);
  }, []);
  const term = useTerminal(dto.id, live && termReady, termRef, { org, projectId, number });
  // The saved Transcript: asked for only once there is no pod to ask (not live, starting or resuming), and reloaded
  // when the pod goes away.
  const wantsTranscript = area !== 'live' && area !== 'starting' && area !== 'resuming';
  const transcriptQuery = useInfiniteQuery({
    ...runsQueries.transcript(org, projectId, number),
    enabled: wantsTranscript,
  });
  useTranscriptReload(org, projectId, number, area);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  // The Stop confirm belongs to the live run: once the run leaves the live terminal (pausing, paused, ended) it closes,
  // so it does not reopen unprompted when the run is live again.
  if (confirmingStop && !live) setConfirmingStop(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const onError = (e: unknown) => toast.show(toastFromError(e));
  const cancel = useCancelRun(org, projectId, { onError });
  const finish = useFinishRun(org, projectId, { onError });
  // A 409 (not resumable, already being resumed, no credential) toasts the server's message.
  const resume = useResumeRun(org, projectId, { onError });
  // A 409 (not started, already ending, not live, started before Stop session existed) toasts the server's message.
  const stop = useStopRun(org, projectId, { onError });
  // A 409 (not reopened any more, no longer active) toasts the server's message.
  const closeSession = useCloseSession(org, projectId, { onError });

  const { paths } = page;
  const target = { id: dto.id, number };
  // The action buttons show only where the viewer holds the permission on this run: a member on their own runs, an
  // admin or owner on any, a viewer on none. The API decides; this only keeps buttons that would answer 403 away.
  const access = useAccess(org);
  const runTarget = { projectId, ownerUserId: dto.ownerUserId };
  const mayUpdate = access !== undefined && can(access, 'run:update', runTarget);
  const mayCancel = access !== undefined && can(access, 'run:cancel', runTarget);
  // The extra keys (phone): only while the socket is open and writable, and only for someone who may attach to this run.
  // Hiding is a convenience; the socket's own 4403 is the authority.
  const mayAttach = access !== undefined && can(access, 'terminal:attach', runTarget);
  const viewportHeight = useVisualViewportHeight(useMediaQuery(BELOW_DESKTOP));
  const onKey = useCallback((key: TerminalKey) => termRef.current?.sendKey(key), []);
  const mapped = withDetailPrStates(
    toRunDetail(
      dto,
      events,
      page.dto,
      ticketRuns.items,
      now,
      {
        runs: paths.runs,
        ...(page.desk.agent && { agent: paths.agent }),
        ...(page.desk.setup && { setup: paths.setup }),
      },
      linkedTickets,
    ),
    prStates,
  );
  // No pod (final, or paused): the terminal bar says so and the saved Transcript, or else the stored scrollback, shows.
  const stored = final || dto.status === 'paused';
  const scrollbackStored = stored ? scrollbackText(events) : undefined;
  const firstPage = transcriptQuery.data?.pages[0];
  // A failed refetch keeps the pages already loaded; only a load that never succeeded shows the error.
  const transcriptFailed = firstPage === undefined && transcriptQuery.isError;
  const transcriptLoading = firstPage === undefined && !transcriptFailed;
  const hasEntries = (firstPage?.items.length ?? 0) > 0;
  // An empty saved Transcript on a paused or ended run falls back to the stored scrollback when there is one (the
  // session ending always shows the Transcript: the end flush lands with the park and the page refetches then).
  const showTranscript =
    wantsTranscript &&
    (pausing || hasEntries || transcriptLoading || transcriptFailed || scrollbackStored === undefined);
  const transcript: TranscriptProps | undefined = !showTranscript
    ? undefined
    : transcriptFailed
      ? {
          state: 'error',
          items: [],
          ...(transcriptQuery.error instanceof ApiError &&
            transcriptQuery.error.requestId !== undefined && { requestId: transcriptQuery.error.requestId }),
          onRetry: () => void transcriptQuery.refetch(),
        }
      : transcriptLoading
        ? { state: 'loading', items: [] }
        : {
            state: 'ready',
            items: transcriptItems(transcriptQuery.data?.pages ?? [], dto.agent.name),
            hasEarlier: transcriptQuery.hasNextPage,
            loadingEarlier: transcriptQuery.isFetchingNextPage,
            onShowEarlier: () => void transcriptQuery.fetchNextPage(),
          };
  const data = transcript
    ? { ...mapped, connection: transcriptConnection(area, !transcriptFailed && !transcriptLoading && !hasEntries) }
    : stored
      ? mapped
      : { ...mapped, connection: live ? terminalConnection(term.state, stream) : streamConnection(stream) };
  const scrollback = transcript ? undefined : scrollbackStored;
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
      lines={stored && !transcript ? scrollbackLines(events) : undefined}
      transcript={transcript}
      terminal={terminal}
      // The "terminal lost" overlay belongs to a live terminal that gave up; never to queued, starting or final runs.
      onReconnect={live ? term.reconnect : undefined}
      reconnectOverlay={live && term.state === 'gave_up'}
      reconnectBody={live ? GAVE_UP_BODY : undefined}
      inactiveBody={live && term.state === 'inactive' ? INACTIVE_BODY : undefined}
      maxRunsPerTicket={page.dto.maxRunsPerTicket}
      links={{
        ...(page.desk.skills && { skills: paths.skills }),
        ...(page.desk.rules && { rules: paths.rules }),
        ...(page.desk.setup && { setup: paths.setup }),
      }}
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
      {...(mayCancel && { onCancel: () => setConfirmingCancel(true) })}
      onCancelClose={() => setConfirmingCancel(false)}
      onCancelConfirm={() => {
        setConfirmingCancel(false);
        cancel(target);
      }}
      {...(mayUpdate && {
        onFinish: () => finish(target),
        onResume: () => resume.mutate(target),
        onStopOpen: () => setConfirmingStop(true),
        onStop: () => {
          setConfirmingStop(false);
          stop.mutate(target);
        },
        onCloseSession: () => closeSession.mutate(target),
      })}
      onKey={live && term.state === 'open' && mayAttach ? onKey : undefined}
      viewportHeight={viewportHeight}
      resuming={resume.isPending}
      stopConfirmOpen={confirmingStop && live}
      onStopClose={() => setConfirmingStop(false)}
      stopping={stop.isPending}
      closing={closeSession.isPending}
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
