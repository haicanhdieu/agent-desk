import type { RunStatus } from '@/ds/tokens';
import type { TicketKind } from '@/ds/TicketRef';

export type Label = { name: string; color: string };
export type Ticket = { kind: TicketKind; number: number; title: string; labels: Label[]; state?: string; href: string };
export type Actor = { login: string; initials?: string; bot?: boolean };
export type RunSummary = {
  id: number;
  status: RunStatus;
  statusNote?: string;
  command: string;
  skill: string;
  agent: string;
  model: string;
  ticket: Ticket;
  triggeredBy: Actor;
  startedAt: string;
  duration?: string;
};
export type TicketGroup = {
  ticket: Ticket;
  chainNote?: string;
  runsUsed: number;
  runsMax: number;
  runs: RunSummary[];
};
