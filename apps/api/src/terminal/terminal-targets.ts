import { eq } from 'drizzle-orm';
import { projects, runs, setupTests, type Tx } from '@agentdesk/db';
import { SIGNAL, runJobName, setupTestJobName } from '@agentdesk/core';

/**
 * What a terminal websocket attaches to. The relay (auth, origin check, caps, byte handling) is shared; a target says
 * how to find the row, whether it is attachable, which pod to exec into and what to signal around the attach.
 */
export interface TerminalTarget {
  kind: 'run' | 'setup-test';
  /** Route path with exactly one `:param`, the target id. */
  path: string;
  /** Org-scoped (the caller passes a `withOrg` tx). `createdBy` is the owning project's creator. */
  lookup(
    tx: Tx,
    id: string,
  ): Promise<{ createdBy: string | null; active: boolean; sessionEnded: boolean; jobName: string } | null>;
  /**
   * `connectionId` is the id the API made for this socket (a UUID, never client text). Rejects when the signal could not
   * be delivered; the gateway then sends no matching detach and no lease.
   */
  onAttach?(id: string, connectionId: string): Promise<void>;
  onDetach?(id: string, connectionId: string): Promise<void>;
  /** The connection ids of the sockets still open for this target id; sent on a timer while any is open. */
  onLease?(id: string, connectionIds: string[]): Promise<void>;
  /** A person typed into this target's terminal (best effort; the run target signals personInput). */
  onPersonInput?(id: string): Promise<void>;
}

/** Connection-map key: a run id and a setup-test id can never collide. */
export const terminalKey = (target: Pick<TerminalTarget, 'kind'>, id: string): string => `${target.kind}:${id}`;

/** Delivers a named signal, with its arguments, to a run's workflow (the gateway's retry policy); false when it gave up. */
export type RunSignaller = (runId: string, name: string, args: unknown[]) => Promise<boolean>;

export function runTarget(signalWithRetry: RunSignaller, path: string): TerminalTarget {
  const send = async (id: string, name: string, args: unknown[]): Promise<void> => {
    if (!(await signalWithRetry(id, name, args))) throw new Error('signal not delivered');
  };
  return {
    kind: 'run',
    path,
    lookup: async (tx, id) => {
      const row = (
        await tx
          .select({ status: runs.status, sessionEndingAt: runs.sessionEndingAt, createdBy: projects.createdBy })
          .from(runs)
          .innerJoin(projects, eq(projects.id, runs.projectId))
          .where(eq(runs.id, id))
          .limit(1)
      )[0];
      if (!row) return null;
      return {
        createdBy: row.createdBy,
        active: row.status === 'running' || row.status === 'idle' || row.status === 'done',
        // The session is ending (the idle timer or Finish) or already parked: nothing to attach to (4410, no retry).
        sessionEnded: row.sessionEndingAt !== null || row.status === 'paused',
        jobName: runJobName(id),
      };
    },
    onAttach: (id, connectionId) => send(id, SIGNAL.terminalAttached, [connectionId]),
    onDetach: (id, connectionId) => send(id, SIGNAL.terminalDetached, [connectionId]),
    onLease: (id, connectionIds) => send(id, SIGNAL.terminalLease, [connectionIds]),
    onPersonInput: (id) => send(id, SIGNAL.personInput, []),
  };
}

export function setupTestTarget(path: string): TerminalTarget {
  return {
    kind: 'setup-test',
    path,
    lookup: async (tx, id) => {
      const row = (
        await tx
          .select({ createdBy: projects.createdBy, status: setupTests.status, endedAt: setupTests.endedAt })
          .from(setupTests)
          .innerJoin(projects, eq(projects.id, setupTests.projectId))
          .where(eq(setupTests.id, id))
          .limit(1)
      )[0];
      if (!row) return null;
      return {
        createdBy: row.createdBy,
        active: row.endedAt === null && row.status !== 'queued',
        sessionEnded: false,
        jobName: setupTestJobName(id),
      };
    },
  };
}
