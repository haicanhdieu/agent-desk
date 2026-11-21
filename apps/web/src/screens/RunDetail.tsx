import type { ReactNode } from 'react';
import { Button, CommandChip, CountBadge, IconButton, Popover, StatusBadge, TicketRef } from '@/ds';
import { AppShell, PopoverCard, TopBar, TopBarSeparator, type TermLine, type TranscriptProps } from '@/components';
import type { RunDetailData } from '@/mocks';
import { user as boardUser } from '@/mocks';
import type { Actor } from '@/mocks/types';
import styles from './Screens.module.css';
import { RunSidePanel } from './RunSidePanel';
import { RunTerminalArea } from './RunTerminalArea';

export interface RunDetailProps {
  data: RunDetailData;
  lines?: TermLine[];
  needsYou: number;
  panelCollapsed?: boolean;
  cancelConfirmOpen?: boolean;
  /** Board height in pixels; `'viewport'` fills the window (the app route). */
  height?: number | 'viewport';
  projectName?: string;
  onCancel?(): void;
  onCancelClose?(): void;
  onCancelConfirm?(): void;
  onFinish?(): void;
  /** Resume a paused run, or re-open a succeeded run whose session is kept. */
  onResume?(): void;
  /** A resume request is in flight: Resume, Reopen session and Finish wait. */
  resuming?: boolean;
  onReconnect?(): void;
  onTogglePanel?(): void;
  /** Replaces the static terminal of a running, idle or ended run (the live terminal). */
  terminal?: ReactNode;
  /** A cancel or finish in flight ("Finishing…"): shown in the top bar; Finish and Cancel wait for it. */
  pendingNote?: string;
  /** The cancel confirmation's text; defaults to the board's. */
  cancelBody?: ReactNode;
  /** In-app hrefs; default to the prototype's. */
  links?: RunDetailLinks;
  /** Shows the terminal's "Connection to the terminal lost" overlay (`false` suppresses it); defaults to the connection reconnecting. */
  reconnectOverlay?: boolean;
  /** That overlay's text; defaults to the board's. */
  reconnectBody?: ReactNode;
  /** Shows the "Terminal closed for inactivity" overlay with this text and a Reconnect button (see RunTerminalArea). */
  inactiveBody?: ReactNode;
  /** The signed-in user in the top bar; defaults to the board's. */
  user?: Actor;
  /** The project's run limit per ticket (the chain's "max N runs"); defaults to the board's 10. */
  maxRunsPerTicket?: number;
  /** No live pod: show this Transcript in the terminal area (see RunTerminalArea). */
  transcript?: TranscriptProps;
  /** Opens the "Stop the session?" confirm (Stop session pressed while the agent works). */
  onStopOpen?(): void;
  stopConfirmOpen?: boolean;
  onStopClose?(): void;
  /** Stops the session: Stop session pressed on an idle or done run, or confirmed. */
  onStop?(): void;
  /** A stop request is in flight: the action buttons wait. */
  stopping?: boolean;
  /** Closes a reopened session (the only action while `data.reopened`). */
  onCloseSession?(): void;
  /** A close request is in flight: the action buttons wait. */
  closing?: boolean;
}

export interface RunDetailLinks {
  projects?: string;
  runs?: string;
  skills?: string;
  rules?: string;
  /** Desk workspace setup (the Setup row of the side panel). */
  setup?: string;
}

const ENDED = ['succeeded', 'failed', 'timed_out', 'cancelled', 'expired'];
/** Mirrors the contracts' FINISHABLE_RUN_STATUSES (screens do not import contracts); a paused run has its own Finish. */
const FINISHABLE = ['idle', 'done'];
/** Mirrors the contracts' STOPPABLE_RUN_STATUSES (screens do not import contracts). */
const STOPPABLE = ['running', 'idle', 'done'];
const STOP_ENDING_HINT = 'The session is already ending';
const CLOSE_ENDING_HINT = 'The session is already ending';
const CLOSE_STARTING_HINT = 'The session is still starting';
const FINISH_HINT = 'Finish is available when the agent is waiting for you';

export function RunDetail({
  data,
  lines,
  needsYou,
  panelCollapsed,
  cancelConfirmOpen,
  height = 900,
  projectName = 'invoicer-api',
  onCancel,
  onCancelClose,
  onCancelConfirm,
  onFinish,
  onResume,
  resuming,
  onReconnect,
  onTogglePanel,
  terminal,
  pendingNote,
  cancelBody,
  links,
  reconnectOverlay,
  reconnectBody,
  inactiveBody,
  user = boardUser,
  maxRunsPerTicket,
  transcript,
  onStopOpen,
  stopConfirmOpen,
  onStopClose,
  onStop,
  stopping,
  onCloseSession,
  closing,
}: RunDetailProps) {
  const { run } = data;
  const t = run.ticket;
  const ended = ENDED.includes(run.status);
  const finishable = FINISHABLE.includes(run.status);
  // A paused run's buttons (Resume, Finish) are in the notice above the terminal, so the top bar only links out.
  const parked = run.status === 'paused';
  const stoppable = STOPPABLE.includes(run.status);
  const busy = pendingNote !== undefined || resuming === true || stopping === true || closing === true;
  // A reopened session of a succeeded run: its result is fixed, so Finish, Stop and Cancel are gone (ADR 0032).
  const reopened = data.reopened === true;
  const starting = run.status === 'queued' || run.status === 'starting';

  const actions = (
    <>
      {reopened ? (
        <Button
          icon="check"
          disabled={data.pausing === true || starting || busy}
          title={data.pausing ? CLOSE_ENDING_HINT : starting ? CLOSE_STARTING_HINT : undefined}
          onClick={onCloseSession}
        >
          Close session
        </Button>
      ) : ended || parked ? (
        <Button icon="external" href={t.href} target="_blank" rel="noopener noreferrer">
          {t.kind === 'pr' ? 'View PR' : 'View issue'}
        </Button>
      ) : (
        <>
          {/* Disabled like the board unless the run needs you or is done; the title explains why. */}
          <Button
            icon="check"
            disabled={!finishable || busy}
            title={finishable ? undefined : FINISH_HINT}
            onClick={onFinish}
          >
            {finishable ? 'Finish run' : 'Finish'}
          </Button>
          {stoppable && (
            <Button
              icon="pause"
              disabled={data.pausing === true || busy}
              title={data.pausing ? STOP_ENDING_HINT : undefined}
              onClick={run.status === 'running' ? onStopOpen : onStop}
            >
              Stop session
            </Button>
          )}
          <Button variant="danger" icon="x" disabled={busy} onClick={onCancel}>
            Cancel run
          </Button>
        </>
      )}
      <TopBarSeparator />
      <IconButton
        icon="panel"
        aria-label="Collapse context panel (])"
        title="Collapse panel  ]"
        onClick={onTogglePanel}
      />
      <IconButton icon="fullscreen" aria-label="Full screen terminal (F)" title="Full screen  F" />
    </>
  );

  return (
    <AppShell
      height={height}
      topBar={
        <TopBar
          variant="run"
          user={user}
          links={{ projects: links?.projects }}
          breadcrumb={[
            { label: projectName, href: links?.projects ?? '/projects' },
            {
              label: (
                <>
                  Runs <CountBadge count={needsYou} title="Needs you" />
                </>
              ),
              href: links?.runs ?? '/runs',
            },
            { label: `Run ${run.id}` },
          ]}
          actions={actions}
        >
          {reopened ? (
            <StatusBadge status="succeeded" variant="pill">
              Succeeded · Session open
            </StatusBadge>
          ) : (
            <StatusBadge status={run.status} variant="pill">
              {data.failureStage === 'setup' ? 'Setup failed' : undefined}
            </StatusBadge>
          )}
          <span>
            <CommandChip>{run.command}</CommandChip> on{' '}
            <TicketRef kind={t.kind} number={t.number} prState={t.prState} />
          </span>
          <span className="num muted">{ended ? (run.duration ?? data.elapsed) : data.elapsed}</span>
          {busy && (
            <span className="muted" role="status">
              {pendingNote}
            </span>
          )}
        </TopBar>
      }
    >
      <main className={styles.runMain}>
        <RunTerminalArea
          data={data}
          lines={lines}
          terminal={terminal}
          busy={busy}
          onFinish={onFinish}
          onResume={onResume}
          onReconnect={onReconnect}
          reconnectOverlay={reconnectOverlay}
          reconnectBody={reconnectBody}
          inactiveBody={inactiveBody}
          transcript={transcript}
        />
        <RunSidePanel
          data={data}
          collapsed={panelCollapsed}
          onExpand={onTogglePanel}
          links={{ skills: links?.skills, rules: links?.rules, setup: links?.setup }}
          maxRunsPerTicket={maxRunsPerTicket}
        />
      </main>
      <Popover
        open={!!cancelConfirmOpen}
        role="dialog"
        label={`Cancel run ${run.id}?`}
        onClose={onCancelClose}
        width={340}
        style={{ right: 150, top: 56 }}
      >
        <PopoverCard
          title={`Cancel run ${run.id}?`}
          body={
            cancelBody ?? (
              <>
                The pod is stopped now. Work the agent has not pushed is lost; branch{' '}
                <span className="mono">ad/139-rate-limit-webhooks</span> has no pushes yet. A &quot;cancelled&quot;
                comment is posted on issue #{t.number}.
              </>
            )
          }
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={onCancelClose}>
                Keep running
              </Button>
              <Button variant="solid-danger" size="sm" onClick={onCancelConfirm}>
                Cancel run
              </Button>
            </>
          }
        />
      </Popover>
      <Popover
        open={!!stopConfirmOpen && stoppable && data.pausing !== true}
        role="dialog"
        label="Stop the session?"
        onClose={onStopClose}
        width={340}
        style={{ right: 290, top: 56 }}
      >
        <PopoverCard
          title="Stop the session?"
          body={
            <>
              The agent is in the middle of a step. Stopping now cuts that step short. Everything up to now is kept, and
              you can resume for {data.pausedKeep}.
            </>
          }
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={onStopClose}>
                Keep running
              </Button>
              <Button variant="primary" size="sm" icon="pause" onClick={onStop}>
                Stop session
              </Button>
            </>
          }
        />
      </Popover>
    </AppShell>
  );
}
