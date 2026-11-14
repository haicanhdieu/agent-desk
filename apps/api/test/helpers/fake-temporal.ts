import type { Client } from '@temporalio/client';

export type FakeCallKind =
  | 'start'
  | 'signal'
  | 'signalWithStart'
  | 'update'
  | 'scheduleCreate'
  | 'scheduleUpdate'
  | 'scheduleDelete'
  | 'schedulePause'
  | 'scheduleUnpause'
  | 'scheduleTrigger'
  | 'terminate';

export interface FakeCall {
  kind: FakeCallKind;
  /** Set for workflow calls. */
  workflowId?: string;
  /** Set for schedule calls. */
  scheduleId?: string;
  args: unknown[];
}

/**
 * Records the Temporal client calls the API makes. `client` is the object to inject as TEMPORAL_CLIENT; it
 * implements only the surface the API uses (workflow.start/signalWithStart/getHandle().signal|executeUpdate|terminate,
 * schedule.create/getHandle().update|delete|pause|unpause|trigger, workflowService.getSystemInfo).
 */
export class FakeTemporalClient {
  readonly calls: FakeCall[] = [];
  /** When false, getSystemInfo rejects, so /readyz reports 503. */
  available = true;
  /** When true, every workflow/schedule call rejects (nothing is recorded). */
  failing = false;
  /** Awaited before each workflow signal is recorded; may delay or throw (per signal name). */
  signalHook?: (name: unknown) => Promise<void>;
  /** Returns an error to reject a workflow signal with (nothing is recorded), or undefined to let it through. */
  signalFailure?: (workflowId: string | undefined, name: unknown) => unknown;
  /** Returns an error to reject a workflow update with (nothing is recorded), or undefined to let it through. */
  updateFailure?: (workflowId: string | undefined, name: unknown) => unknown;
  /** Awaited before a workflow start is recorded; lets a test hold a start back. */
  startHook?: (workflowId: string | undefined) => Promise<void>;
  /** When set, workflow start rejects with it (nothing is recorded). */
  startError?: unknown;
  /** When set, workflow terminate rejects with it (after recording the call). */
  terminateError?: unknown;

  private record(call: FakeCall): void {
    if (this.failing) throw new Error('temporal call failed (fake)');
    this.calls.push(call);
  }

  private workflowHandle(workflowId: string | undefined) {
    return {
      workflowId,
      signal: async (...args: unknown[]) => {
        await this.signalHook?.(args[0]);
        const failure = this.signalFailure?.(workflowId, args[0]);
        if (failure !== undefined) throw failure;
        this.record({ kind: 'signal', workflowId, args });
      },
      executeUpdate: async (...args: unknown[]) => {
        const failure = this.updateFailure?.(workflowId, args[0]);
        if (failure !== undefined) throw failure;
        this.record({ kind: 'update', workflowId, args });
      },
      terminate: async (...args: unknown[]) => {
        this.record({ kind: 'terminate', workflowId, args });
        if (this.terminateError !== undefined) throw this.terminateError;
      },
    };
  }

  private readonly surface = {
    workflow: {
      start: async (workflowType: unknown, options: { workflowId?: string }) => {
        await this.startHook?.(options.workflowId);
        if (this.startError !== undefined) throw this.startError;
        this.record({ kind: 'start', workflowId: options.workflowId, args: [workflowType, options] });
        return this.workflowHandle(options.workflowId);
      },
      signalWithStart: async (workflowType: unknown, options: { workflowId?: string }) => {
        this.record({ kind: 'signalWithStart', workflowId: options.workflowId, args: [workflowType, options] });
        return this.workflowHandle(options.workflowId);
      },
      getHandle: (workflowId: string) => this.workflowHandle(workflowId),
    },
    schedule: {
      create: async (options: { scheduleId?: string }) => {
        this.record({ kind: 'scheduleCreate', scheduleId: options.scheduleId, args: [options] });
        return { scheduleId: options.scheduleId };
      },
      getHandle: (scheduleId: string) => ({
        scheduleId,
        update: async (...args: unknown[]) => void this.record({ kind: 'scheduleUpdate', scheduleId, args }),
        delete: async () => void this.record({ kind: 'scheduleDelete', scheduleId, args: [] }),
        pause: async (...args: unknown[]) => void this.record({ kind: 'schedulePause', scheduleId, args }),
        unpause: async (...args: unknown[]) => void this.record({ kind: 'scheduleUnpause', scheduleId, args }),
        trigger: async (...args: unknown[]) => void this.record({ kind: 'scheduleTrigger', scheduleId, args }),
      }),
    },
    workflowService: {
      getSystemInfo: async () => {
        if (!this.available) throw new Error('temporal unavailable (fake)');
        return {};
      },
    },
  };

  /** The structural fake handed to the API in place of `Client`; the cast is confined to this one place. */
  get client(): Client {
    return this.surface as unknown as Client;
  }

  callsOfKind(kind: FakeCallKind): FakeCall[] {
    return this.calls.filter((c) => c.kind === kind);
  }

  reset(): void {
    this.calls.length = 0;
    this.available = true;
    this.failing = false;
    this.signalHook = undefined;
    this.signalFailure = undefined;
    this.updateFailure = undefined;
    this.startHook = undefined;
    this.startError = undefined;
    this.terminateError = undefined;
  }
}
