import type { ReactNode } from 'react';
import { Button, CommandChip, CountBadge, IconButton, Popover, StatusBadge, TicketRef } from '@/ds';
import { AppShell, PopoverCard, TopBar, TopBarSeparator, type TermLine } from '@/components';
import type { RunDetailData } from '@/mocks';
import { user } from '@/mocks';
import styles from './Screens.module.css';
import { RunSidePanel } from './RunSidePanel';
import { RunTerminalArea } from './RunTerminalArea';

export interface RunDetailProps {
  data: RunDetailData;
  lines?: TermLine[];
  needsYou: number;
  panelCollapsed?: boolean;
  cancelConfirmOpen?: boolean;
  height?: number;
  projectName?: string;
  onCancel?(): void;
  onCancelClose?(): void;
  onCancelConfirm?(): void;
  onFinish?(): void;
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
}

export interface RunDetailLinks {
  projects?: string;
  runs?: string;
  skills?: string;
  rules?: string;
}

const ENDED = ['succeeded', 'failed', 'timed_out', 'cancelled'];
const FINISH_HINT = 'Finish is available when the agent is waiting for you';

export function RunDetail({
  data, lines, needsYou, panelCollapsed, cancelConfirmOpen, height = 900, projectName = 'invoicer-api',
  onCancel, onCancelClose, onCancelConfirm, onFinish, onReconnect, onTogglePanel, terminal, pendingNote, cancelBody,
  links,
}: RunDetailProps) {
  const { run } = data;
  const t = run.ticket;
  const ended = ENDED.includes(run.status);
  const idle = run.status === 'idle';
  const busy = pendingNote !== undefined;

  const actions = (
    <>
      {ended ? (
        <Button icon="external" href={t.href}>View ticket</Button>
      ) : (
        <>
          {/* Disabled like the board; the title explains why (not focusable by design: Finish does nothing yet). */}
          <Button icon="check" disabled={!idle || busy} title={idle ? undefined : FINISH_HINT} onClick={onFinish}>
            {idle ? 'Finish run' : 'Finish'}
          </Button>
          <Button variant="danger" icon="x" disabled={busy} onClick={onCancel}>Cancel run</Button>
        </>
      )}
      <TopBarSeparator />
      <IconButton icon="panel" aria-label="Collapse context panel (])" title="Collapse panel  ]" onClick={onTogglePanel} />
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
            { label: <>Runs <CountBadge count={needsYou} title="Needs you" /></>, href: links?.runs ?? '/runs' },
            { label: `Run ${run.id}` },
          ]}
          actions={actions}
        >
          <StatusBadge status={run.status} variant="pill" />
          <span><CommandChip>{run.command}</CommandChip> on <TicketRef kind={t.kind} number={t.number} /></span>
          <span className="num muted">{ended ? run.duration ?? data.elapsed : data.elapsed}</span>
          {busy && <span className="muted" role="status">{pendingNote}</span>}
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
          onReconnect={onReconnect}
        />
        <RunSidePanel
          data={data}
          collapsed={panelCollapsed}
          onExpand={onTogglePanel}
          links={{ skills: links?.skills, rules: links?.rules }}
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
          body={cancelBody ?? <>The pod is stopped now. Work the agent has not pushed is lost; branch <span className="mono">ad/139-rate-limit-webhooks</span> has no pushes yet. A &quot;cancelled&quot; comment is posted on issue #{t.number}.</>}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={onCancelClose}>Keep running</Button>
              <Button variant="solid-danger" size="sm" onClick={onCancelConfirm}>Cancel run</Button>
            </>
          }
        />
      </Popover>
    </AppShell>
  );
}
