import {
  FINAL_RUN_STATUSES,
  type ProjectRunEvent,
  type RunEventDto,
  type RunStatus,
  type RunStatusEvent,
  type SetupTestDto,
} from '@agentdesk/contracts';
import { sse, type HttpHandler } from 'msw';
import { ids } from '../dto/ids';
import { mockDb } from './db';
import { streamGuards } from './handlers';
import {
  playSetupTest,
  statusMessage,
  subscribeProject,
  subscribeRun,
  subscribeSetupTest,
  type ScriptStep,
} from './live';

// SSE for `dev:mock` and Storybook (browser only: msw's `sse()` needs a real EventSource, so Vitest uses
// FakeEventSource instead). GET /api/runs/:runId/events replays the stored events after `after` (or, without
// it, the Last-Event-ID the browser sends on reconnect) with `id: <seq>`, then live changes; status frames carry no
// id. It ends on a final status.
// GET /api/setup-tests/:setupTestId/events sends `event` frames after `after` and the test's `status`, then live
// changes (the first stream of a queued test starts its scripted setup); it ends once the test has ended.
// GET /api/projects/:projectId/events sends `run` messages for status changes in the project.

const isFinal = (s: RunStatus) => FINAL_RUN_STATUSES.some((f) => f === s);

/** Scripted by default in dev:mock: queued run 63 starts, attaches and goes idle once its page is open. */
export const DEFAULT_RUN_SCRIPT: { runId: string; steps: ScriptStep[] } = {
  runId: ids.run(1, 63),
  steps: [
    { afterMs: 2_000, status: 'starting' },
    { afterMs: 2_500, lifecycle: 'Pod running' },
    { afterMs: 2_000, lifecycle: 'Claude Code started' },
    { afterMs: 1_500, status: 'running' },
    { afterMs: 8_000, lifecycle: 'Turn finished', status: 'idle' },
  ],
};

const runOf = (runId: unknown) => mockDb.state.runs.find((r) => r.id === runId);
const asNumber = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : 0);

/** Calls `send` until it throws (the page closed the stream), then unsubscribes. */
function safe<T>(send: (m: T) => void, stop: () => void): (m: T) => void {
  return (m) => {
    try {
      send(m);
    } catch {
      stop();
    }
  };
}

export const streamHandlers: HttpHandler[] = [
  // Auth and scope first (handlers.ts): a guard that answers nothing falls through to the stream handler.
  streamGuards['runs.events'],
  streamGuards['projects.events'],
  streamGuards['setupTests.events'],
  sse<{ event: RunEventDto; status: RunStatusEvent }>('/api/runs/:runId/events', ({ request, params, client }) => {
    const run = runOf(params.runId);
    if (!run) return;
    const url = new URL(request.url);
    // As the API: the `after` query wins; the Last-Event-ID header applies only without it.
    const query = url.searchParams.get('after');
    const after = asNumber(query ?? request.headers.get('last-event-id'));
    const backlog = (mockDb.state.runEvents[run.id] ?? []).filter((e) => e.seq > after);
    for (const e of backlog) client.send({ event: 'event', id: String(e.seq), data: e });
    const lastSeq = mockDb.state.runEvents[run.id]?.at(-1)?.seq ?? after;
    client.send({ event: 'status', data: statusMessage(run, lastSeq) });
    if (isFinal(run.status)) {
      client.close();
      return;
    }
    let stop = () => {};
    stop = subscribeRun(
      run.id,
      safe(
        (m) => {
          client.send(m);
          if (m.event === 'status' && isFinal(m.data.status)) {
            stop();
            client.close();
          }
        },
        () => stop(),
      ),
    );
  }),
  sse<{ event: RunEventDto; status: SetupTestDto }>(
    '/api/setup-tests/:setupTestId/events',
    ({ request, params, client }) => {
      const test = mockDb.state.setupTests.find((t) => t.id === params.setupTestId);
      if (!test) return;
      const query = new URL(request.url).searchParams.get('after');
      const after = asNumber(query ?? request.headers.get('last-event-id'));
      for (const e of (mockDb.state.setupTestEvents[test.id] ?? []).filter((x) => x.seq > after)) {
        client.send({ event: 'event', id: String(e.seq), data: e });
      }
      client.send({ event: 'status', data: structuredClone(test) });
      if (test.status === 'ended') {
        client.close();
        return;
      }
      let stop = () => {};
      stop = subscribeSetupTest(
        test.id,
        safe(
          (m) => {
            client.send(m);
            if (m.event === 'status' && m.data.status === 'ended') {
              stop();
              client.close();
            }
          },
          () => stop(),
        ),
      );
      if (test.status === 'queued') playSetupTest(test.id);
    },
  ),
  sse<{ run: ProjectRunEvent }>('/api/projects/:projectId/events', ({ params, client }) => {
    if (typeof params.projectId !== 'string') return;
    let stop = () => {};
    stop = subscribeProject(
      params.projectId,
      safe(
        (m) => client.send({ event: 'run', data: m }),
        () => stop(),
      ),
    );
  }),
];
