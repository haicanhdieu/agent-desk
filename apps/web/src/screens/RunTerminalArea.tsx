import type { ReactNode } from 'react';
import { Banner, Button, Popover, StatusIcon, type IconName } from '@/ds';
import {
  ConnectionIndicator,
  EventLog,
  Note,
  PopoverCard,
  StartupChecklist,
  Terminal,
  TerminalBar,
  TerminalPane,
  TerminalPlaceholder,
  Transcript,
  type TermLine,
  type TranscriptProps,
} from '@/components';
import type { RunDetailData } from '@/mocks';

export interface RunTerminalAreaProps {
  data: RunDetailData;
  lines?: TermLine[];
  /** Replaces the static terminal (the live terminal, Task 14). */
  terminal?: ReactNode;
  /** A cancel, finish or resume is in flight: Finish, Resume and Reopen session wait. */
  busy?: boolean;
  onFinish?(): void;
  /** Resume a paused run, or re-open a succeeded run whose session is kept. */
  onResume?(): void;
  onReconnect?(): void;
  /** Shows the "Connection to the terminal lost" overlay (`false` suppresses it); defaults to the connection reconnecting (the board). */
  reconnectOverlay?: boolean;
  /** The overlay's text; defaults to the board's. */
  reconnectBody?: ReactNode;
  /**
   * Shows the "Terminal closed for inactivity" overlay with this text and a Reconnect button (`onReconnect`): the browser
   * closed the socket because the page was unused, so the run can pause when it is idle. Replaces the reconnect overlay.
   */
  inactiveBody?: ReactNode;
  /**
   * No live pod: show this Transcript in the terminal area (bar: one "Transcript" tab, no Find/Copy all).
   * Absent: today's stored scrollback or placeholder.
   */
  transcript?: TranscriptProps;
  /** The pane's accessible name; defaults to "Terminal", or "Transcript" when a Transcript is shown. */
  label?: string;
}

/** One view tab: the "Transcript, coming in MVP" tab is removed. */
const views = (label: string) => [{ id: 'term', label, icon: 'terminal' as IconName }];

const transcriptViews = (label: string) => [{ id: 'transcript', label, icon: 'transcript' as IconName }];

/** Why a succeeded run cannot be reopened (its disk is gone). */
const REOPEN_UNAVAILABLE_HINT = 'Reopen unavailable: the disk was removed, so the session cannot be reopened';

/** "Copy /cmd" renders the command in mono, like the boards. */
function ActionLabel({ label }: { label: string }) {
  return label.startsWith('Copy /') ? (
    <>
      Copy <span className="mono">{label.slice(5)}</span>
    </>
  ) : (
    <>{label}</>
  );
}

/** Notes under the title: the agent's note, then the session line. */
function SessionLines({ data }: { data: RunDetailData }) {
  return (
    <>
      {data.agentNote && <div>{data.agentNote}</div>}
      {data.session?.detail && <div>{data.session.detail}</div>}
      {data.session?.autoResumeGaveUp && <div>{data.session.autoResumeGaveUp}</div>}
    </>
  );
}

/** The error above the buttons when a resume fell back and the run is parked again. */
function ResumeFailure({ data }: { data: RunDetailData }) {
  const failure = data.session?.resumeFailure;
  if (!failure) return null;
  return <Banner tone="err" flush live="polite" icon={<StatusIcon status="failed" size={18} />} title={failure} />;
}

/** The live session is ending (the idle timer or Finish; the page cannot tell which, so the wording stays neutral): the terminal is closed until the run is parked or finished. */
function PausingNotice() {
  return (
    <Banner
      tone="idle"
      flush
      centered
      live="polite"
      icon={<StatusIcon status="starting" size={20} title="Ending" />}
      title="Session ending…"
    >
      <div>The session is being saved. This page updates by itself when the session has ended.</div>
    </Banner>
  );
}

/** After a Resume, until the agent starts a new turn: what was kept and what was lost. */
function ResumedBanner({ text }: { text: string }) {
  return <Banner tone="off" flush icon={<StatusIcon status="running" size={18} title="Resumed" />} title={text} />;
}

function PausedNotice({
  data,
  busy,
  onResume,
  onFinish,
}: {
  data: RunDetailData;
  busy?: boolean;
  onResume?(): void;
  onFinish?(): void;
}) {
  return (
    <>
      <ResumeFailure data={data} />
      <Banner
        tone="idle"
        flush
        centered
        icon={<StatusIcon status="paused" size={20} title={data.session?.stopped ? 'Stopped' : 'Paused'} />}
        title={data.session?.headline ?? 'Paused: can be resumed'}
        actions={
          <>
            <Button variant="go" icon="play" disabled={busy} onClick={onResume}>
              Resume
            </Button>
            <Button icon="check" disabled={busy} onClick={onFinish}>
              Finish
            </Button>
          </>
        }
      >
        <SessionLines data={data} />
      </Banner>
    </>
  );
}

function ExpiredNotice({ data }: { data: RunDetailData }) {
  return (
    <Banner
      tone="off"
      flush
      centered
      icon={<StatusIcon status="expired" size={18} title="Expired" />}
      title={data.session?.headline ?? 'Expired'}
    />
  );
}

function EndNotice({ data, busy, onResume }: { data: RunDetailData; busy?: boolean; onResume?(): void }) {
  const { endNote, run } = data;
  if (!endNote) return null;
  const status = run.status;
  if (status === 'failed' || status === 'timed_out') {
    return (
      <Banner
        tone={status === 'failed' ? 'err' : 'late'}
        flush
        prominent
        icon={
          <StatusIcon
            status={status}
            size={20}
            title={status === 'timed_out' ? 'Timed out' : data.failureStage === 'setup' ? 'Setup failed' : 'Failed'}
          />
        }
        title={endNote.title}
        actionsPlacement="below"
        actions={endNote.actions.map((a, i) => (
          <Button key={a.label} variant={i === 0 ? 'default' : 'ghost'} icon={a.icon} href={a.href}>
            <ActionLabel label={a.label} />
          </Button>
        ))}
      >
        {endNote.body}
      </Banner>
    );
  }
  const succeeded = status === 'succeeded';
  const kept = succeeded && data.session?.state === 'kept';
  const banner = (
    <Banner
      tone={succeeded ? 'ok' : 'off'}
      flush
      centered
      inlineTitle={!kept}
      icon={
        <StatusIcon
          status={succeeded ? 'succeeded' : 'cancelled'}
          size={18}
          title={succeeded ? 'Succeeded' : 'Cancelled'}
        />
      }
      title={endNote.title}
      actions={
        succeeded ? (
          <>
            {endNote.actions.map((a) => (
              <Button key={a.label} size="sm" href={a.href} iconRight={a.icon}>
                {a.label}
              </Button>
            ))}
            {succeeded && (
              <Button
                variant="go"
                size="sm"
                icon="play"
                disabled={busy || !kept}
                title={kept ? undefined : REOPEN_UNAVAILABLE_HINT}
                onClick={onResume}
              >
                Reopen session
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {endNote.body}
      {kept && <SessionLines data={data} />}
    </Banner>
  );
  // A succeeded run shows a failed resume above its banner: with a kept session, or a queued Resume that found none.
  return succeeded ? (
    <>
      <ResumeFailure data={data} />
      {banner}
    </>
  ) : (
    banner
  );
}

export function RunTerminalArea({
  data,
  lines = [],
  terminal,
  busy,
  onFinish,
  onResume,
  onReconnect,
  reconnectOverlay,
  reconnectBody,
  inactiveBody,
  transcript,
  label,
}: RunTerminalAreaProps) {
  const { run, connection } = data;
  const status = run.status;
  const isEnded =
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'timed_out' ||
    status === 'cancelled' ||
    status === 'expired';
  const reconnecting = connection.state === 'reconnecting';

  const bar = (
    <TerminalBar
      views={views(isEnded ? 'Final scrollback' : status === 'paused' ? 'Saved scrollback' : 'Terminal')}
      activeView="term"
      size={data.termSize}
      connection={<ConnectionIndicator state={connection.state} label={connection.label} />}
    />
  );

  if (status === 'starting' || status === 'queued') {
    return (
      <TerminalPane bar={bar}>
        <TerminalPlaceholder
          title={data.resuming ? 'Resuming the run' : 'Starting the agent'}
          body={
            data.resuming
              ? 'Waiting for a slot, then starting the pod. The terminal opens here by itself when Claude Code is back. You can leave this page.'
              : 'The terminal opens here by itself when Claude Code is ready, usually within a minute. You can leave this page; the run keeps going.'
          }
        >
          <StartupChecklist steps={data.startup ?? []} />
          <Note tone="faint">
            If the pod is still pending after 2 minutes the run fails with the scheduler&apos;s message.
          </Note>
        </TerminalPlaceholder>
      </TerminalPane>
    );
  }

  // No live pod and a Transcript to show: it replaces the terminal, the cancelled placeholder and the saved scrollback.
  if (transcript && (data.pausing || status === 'paused' || isEnded)) {
    const transcriptNotice = data.pausing ? (
      <PausingNotice />
    ) : status === 'paused' ? (
      <PausedNotice data={data} busy={busy} onResume={onResume} onFinish={onFinish} />
    ) : status === 'expired' ? (
      <ExpiredNotice data={data} />
    ) : (
      <EndNotice data={data} busy={busy} onResume={onResume} />
    );
    return (
      <TerminalPane
        label={label ?? 'Transcript'}
        notice={transcriptNotice}
        bar={
          <TerminalBar
            views={transcriptViews(
              status === 'succeeded' && data.session?.state !== 'kept' ? 'Transcript (read-only)' : 'Transcript',
            )}
            activeView="transcript"
            tools={false}
            connection={<ConnectionIndicator state={connection.state} label={connection.label} />}
          />
        }
      >
        <Transcript {...transcript} />
      </TerminalPane>
    );
  }

  if (status === 'cancelled') {
    const branch = data.endNote?.actions[0];
    return (
      <TerminalPane notice={<EndNotice data={data} />} bar={bar}>
        <TerminalPlaceholder
          title="No scrollback was saved"
          body="The pod stopped before the terminal could be captured. What the agent pushed is on GitHub; everything else ended with the pod."
        >
          <EventLog timeWidth={70} events={(data.lifecycle ?? []).map((e) => ({ at: e.at, text: e.text }))} />
          {branch && (
            <div className="row">
              <Button icon={branch.icon} href={branch.href}>
                {branch.label}
              </Button>
            </div>
          )}
        </TerminalPlaceholder>
      </TerminalPane>
    );
  }

  if (data.pausing) {
    return (
      <TerminalPane notice={<PausingNotice />} bar={bar}>
        <Terminal lines={lines} cursor={false} dimmed />
      </TerminalPane>
    );
  }

  const note = data.agentNote;
  const resumed = data.resumed === undefined ? null : <ResumedBanner text={data.resumed} />;
  const liveNotice = data.reopened ? (
    <Banner
      tone="ok"
      flush
      centered
      icon={<StatusIcon status="succeeded" size={20} title="Succeeded" />}
      title="Session open: this run already succeeded"
    >
      {note && <div>{note}</div>}
      <div>
        The result stays as it is. Type in the terminal to keep working, then Close session to save it again. Closing
        keeps the disk for a fresh keep time.
      </div>
    </Banner>
  ) : status === 'done' ? (
    <Banner
      tone="ok"
      flush
      centered
      icon={<StatusIcon status="done" size={20} title="Done" />}
      title="The agent says the task is done"
      actions={
        <Button variant="go" icon="check" disabled={busy} onClick={onFinish}>
          Finish run
        </Button>
      }
    >
      {note && <div>{note}</div>}
      <div>Review the work, type in the terminal to ask for changes, or Finish to end the run as succeeded.</div>
    </Banner>
  ) : status === 'idle' ? (
    <Banner
      tone="idle"
      flush
      centered
      icon={<StatusIcon status="idle" size={20} title="Needs you" />}
      title="The agent is waiting for your answer"
      actions={
        <Button variant="go" icon="check" disabled={busy} onClick={onFinish}>
          Finish run
        </Button>
      }
    >
      {note && <div>{note}</div>}
      <div>
        Type your answer in the terminal below, or Finish to end the run as succeeded. The idle timer is paused while
        this page is attached. Pauses after 30 min with nobody attached.
      </div>
    </Banner>
  ) : undefined;
  const notice = liveNotice ? (
    <>
      {resumed}
      {liveNotice}
    </>
  ) : status === 'paused' ? (
    <PausedNotice data={data} busy={busy} onResume={onResume} onFinish={onFinish} />
  ) : status === 'expired' ? (
    <ExpiredNotice data={data} />
  ) : isEnded ? (
    <EndNotice data={data} busy={busy} onResume={onResume} />
  ) : undefined;

  const overlay =
    inactiveBody !== undefined ? (
      <Popover
        open
        role="status"
        label="Terminal closed for inactivity"
        width={460}
        style={{ left: '50%', top: '30%', transform: 'translateX(-50%)' }}
      >
        <PopoverCard
          icon={<StatusIcon status="paused" size={18} />}
          title="Terminal closed for inactivity"
          body={inactiveBody}
          actions={
            <Button size="sm" icon="refresh" onClick={onReconnect}>
              Reconnect
            </Button>
          }
        />
      </Popover>
    ) : (reconnectOverlay ?? reconnecting) ? (
      <Popover
        open
        role="status"
        label="Connection to the terminal lost"
        width={460}
        style={{ left: '50%', top: '30%', transform: 'translateX(-50%)' }}
      >
        <PopoverCard
          icon={<StatusIcon status="starting" size={18} />}
          title="Connection to the terminal lost"
          body={
            reconnectBody ??
            'The agent keeps working; tmux holds the session. Retrying in 4 s. Input is paused until the screen redraws.'
          }
          actions={
            <Button size="sm" icon="refresh" onClick={onReconnect}>
              Reconnect now
            </Button>
          }
        />
      </Popover>
    ) : undefined;

  return (
    <TerminalPane notice={notice} bar={bar} overlay={overlay}>
      {terminal ?? (
        <Terminal
          lines={lines}
          cursor={status === 'idle' || status === 'done'}
          anchor={status === 'failed' || status === 'timed_out' ? 'top' : 'bottom'}
          dimmed={reconnecting || inactiveBody !== undefined}
        />
      )}
    </TerminalPane>
  );
}
