import type { ReactNode } from 'react';
import { Banner, Button, Popover, StatusIcon, type IconName } from '@/ds';
import {
  ConnectionIndicator, EventLog, Note, PopoverCard, StartupChecklist, Terminal, TerminalBar, TerminalPane,
  TerminalPlaceholder, type TermLine,
} from '@/components';
import type { RunDetailData } from '@/mocks';

export interface RunTerminalAreaProps {
  data: RunDetailData;
  lines?: TermLine[];
  /** Replaces the static terminal (the live terminal, Task 14). */
  terminal?: ReactNode;
  /** A cancel or finish is in flight: Finish waits. */
  busy?: boolean;
  onFinish?(): void;
  onReconnect?(): void;
  /** Shows the "Connection to the terminal lost" overlay; defaults to the connection reconnecting (the board). */
  reconnectOverlay?: boolean;
  /** The overlay's text; defaults to the board's. */
  reconnectBody?: ReactNode;
}

const views = (label: string) => [
  { id: 'term', label, icon: 'terminal' as IconName },
  { id: 'transcript', label: 'Transcript', icon: 'transcript' as IconName, soon: 'coming in MVP' },
];

/** "Copy /cmd" renders the command in mono, like the boards. */
function ActionLabel({ label }: { label: string }) {
  return label.startsWith('Copy /') ? <>Copy <span className="mono">{label.slice(5)}</span></> : <>{label}</>;
}

function EndNotice({ data }: { data: RunDetailData }) {
  const { endNote, run } = data;
  if (!endNote) return null;
  const status = run.status;
  if (status === 'failed' || status === 'timed_out') {
    return (
      <Banner
        tone={status === 'failed' ? 'err' : 'late'}
        flush
        prominent
        icon={<StatusIcon status={status} size={20} title={status === 'failed' ? 'Failed' : 'Timed out'} />}
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
  return (
    <Banner
      tone={succeeded ? 'ok' : 'off'}
      flush
      centered
      inlineTitle
      icon={<StatusIcon status={succeeded ? 'succeeded' : 'cancelled'} size={18} title={succeeded ? 'Succeeded' : 'Cancelled'} />}
      title={endNote.title}
      actions={succeeded ? endNote.actions.map((a) => (
        <Button key={a.label} size="sm" href={a.href} iconRight={a.icon}>{a.label}</Button>
      )) : undefined}
    >
      {endNote.body}
    </Banner>
  );
}

export function RunTerminalArea({
  data, lines = [], terminal, busy, onFinish, onReconnect, reconnectOverlay, reconnectBody,
}: RunTerminalAreaProps) {
  const { run, connection } = data;
  const status = run.status;
  const isEnded = status === 'succeeded' || status === 'failed' || status === 'timed_out' || status === 'cancelled';
  const reconnecting = connection.state === 'reconnecting';

  const bar = (
    <TerminalBar
      views={views(isEnded ? 'Final scrollback' : 'Terminal')}
      activeView="term"
      size={data.termSize}
      connection={<ConnectionIndicator state={connection.state} label={connection.label} />}
    />
  );

  if (status === 'starting' || status === 'queued') {
    return (
      <TerminalPane bar={bar}>
        <TerminalPlaceholder
          title="Starting the agent"
          body="The terminal opens here by itself when Claude Code is ready, usually within a minute. You can leave this page; the run keeps going."
        >
          <StartupChecklist steps={data.startup ?? []} />
          <Note tone="faint">If the pod is still pending after 2 minutes the run fails with the scheduler&apos;s message.</Note>
        </TerminalPlaceholder>
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
          {branch && <div className="row"><Button icon={branch.icon} href={branch.href}>{branch.label}</Button></div>}
        </TerminalPlaceholder>
      </TerminalPane>
    );
  }

  const notice = status === 'idle' ? (
    <Banner
      tone="idle"
      flush
      centered
      icon={<StatusIcon status="idle" size={20} title="Needs you" />}
      title="The agent finished its turn and is waiting for you"
      actions={<Button variant="go" icon="check" disabled={busy} onClick={onFinish}>Finish run</Button>}
    >
      Type your answer in the terminal below, or Finish to end the run as succeeded. The idle timer is paused while this page is attached.
    </Banner>
  ) : isEnded ? <EndNotice data={data} /> : undefined;

  const overlay = (reconnectOverlay ?? reconnecting) ? (
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
        body={reconnectBody ?? 'The agent keeps working; tmux holds the session. Retrying in 4 s. Input is paused until the screen redraws.'}
        actions={<Button size="sm" icon="refresh" onClick={onReconnect}>Reconnect now</Button>}
      />
    </Popover>
  ) : undefined;

  return (
    <TerminalPane notice={notice} bar={bar} overlay={overlay}>
      {terminal ?? (
        <Terminal
          lines={lines}
          cursor={status === 'idle'}
          anchor={status === 'failed' || status === 'timed_out' ? 'top' : 'bottom'}
          dimmed={reconnecting}
        />
      )}
    </TerminalPane>
  );
}
