import type { RunDto, RunEventDto } from '@agentdesk/contracts';
import { FINAL_RUN_STATUSES } from '@agentdesk/contracts';
import { terminalByRun } from '../terminal';
import { ids } from './ids';
import { runFixtures } from './runs';

// Stored `run_events` per run: lifecycle lines and status changes, then the final scrollback for ended runs whose
// terminal appears on a board (mocks/terminal.ts), as plain text.
const plus = (iso: string, s: number) => new Date(Date.parse(iso) + s * 1000).toISOString();
const isFinal = (s: RunDto['status']) => FINAL_RUN_STATUSES.some((f) => f === s);

/** Plain text of a board terminal (spans joined, one line per row). */
export function scrollbackText(runNumber: number): string | undefined {
  const lines = terminalByRun[runNumber];
  return lines?.map((line) => line.map((span) => span.text).join('')).join('\n');
}

export function eventsFor(run: RunDto): RunEventDto[] {
  const out: RunEventDto[] = [];
  const push = (ts: string, type: RunEventDto['type'], payload: Record<string, unknown>) =>
    out.push({ seq: out.length + 1, ts, type, payload });

  push(run.queuedAt, 'lifecycle', { text: 'Comment received, rule matched' });
  push(run.queuedAt, 'status', { status: 'queued' });
  if (run.startedAt) {
    push(run.startedAt, 'status', { status: 'starting' });
    push(plus(run.startedAt, 8), 'lifecycle', { text: 'Pod running' });
    push(plus(run.startedAt, 9), 'status', { status: 'running' });
    push(plus(run.startedAt, 16), 'lifecycle', { text: 'Claude Code started' });
  }
  if (run.idleSince) push(run.idleSince, 'status', { status: 'idle' });
  if (run.finishedAt && isFinal(run.status)) {
    const text = scrollbackText(run.number);
    if (text !== undefined && run.projectId === ids.project.invoicerApi) {
      push(run.finishedAt, 'scrollback', { text });
    }
    push(run.finishedAt, 'status', {
      status: run.status,
      exitCode: run.exitCode,
      failureReason: run.failureReason,
    });
  }
  return out;
}

export const runEventFixtures: Record<string, RunEventDto[]> = Object.fromEntries(
  runFixtures.map((run) => [run.id, eventsFor(run)]),
);
