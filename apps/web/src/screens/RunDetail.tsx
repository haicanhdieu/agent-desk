import type { ReactNode } from 'react';
import { Button, CommandChip, CountBadge, IconButton, Popover, StatusBadge, TicketRef } from '@/ds';
import { AppShell, PopoverCard, TopBar, TopBarSeparator, type TermLine } from '@/components';
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
  /** Shows the terminal's "Connection to the terminal lost" overlay (`false` suppresses it); defaults to the connection reconnecting. */
  reconnectOverlay?: boolean;
  /** That overlay's text; defaults to the board's. */
  reconnectBody?: ReactNode;
  /** The signed-in user in the top bar; defaults to the board's. */
  user?: Actor;
  /** The project's run limit per ticket (the chain's "max N runs"); defaults to the board's 10. */
  maxRunsPerTicket?: number;
}

export interface RunDetailLinks {
  projects?: string;
  runs?: string;
  skills?: string;
  rules?: string;
  /** Desk workspace setup (the Setup row of the side panel). */
  setup?: string;
}

const ENDED = ['succeeded', 'failed', 'timed_out', 'cancelled'];
/** Mirrors the contracts' FINISHABLE_RUN_STATUSES (screens do not import contracts). */
const FINISHABLE = ['idle', 'done'];
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
  onReconnect,
  onTogglePanel,
  terminal,
  pendingNote,
  cancelBody,
  links,
  reconnectOverlay,
  reconnectBody,
  user = boardUser,
  maxRunsPerTicket,
}: RunDetailProps) {
  const { run } = data;
  const t = run.ticket;
  const ended = ENDED.includes(run.status);
  const finishable = FINISHABLE.includes(run.status);
  const busy = pendingNote !== undefined;

  const actions = (
    <>
      {ended ? (
        <Button icon="external" href={t.href}>
          View ticket
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
          <StatusBadge status={run.status} variant="pill">
            {data.failureStage === 'setup' ? 'Setup failed' : undefined}
          </StatusBadge>
          <span>
            <CommandChip>{run.command}</CommandChip> on <TicketRef kind={t.kind} number={t.number} />
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
          onReconnect={onReconnect}
          reconnectOverlay={reconnectOverlay}
          reconnectBody={reconnectBody}
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
    </AppShell>
  );
}
