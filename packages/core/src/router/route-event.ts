import type { RuleDto, TicketKind } from '@agentdesk/contracts';
import type { Ticket, TicketEvent } from '../adapters/types';
import { parseCommand } from './parse-command';

/** The slice of a rule the router reads. Structural, so a parsed DB row or a RuleDto both fit. */
export type RuleRow = Pick<RuleDto, 'id' | 'command' | 'labelFilter' | 'target' | 'agentId' | 'skillName' | 'enabled'>;

export type IgnoredOutcome =
  | 'ignored_no_command'
  | 'ignored_unauthorized'
  | 'ignored_no_rule'
  | 'ignored_rule_disabled'
  | 'ignored_target'
  | 'ignored_labels'
  | 'ignored_max_runs'
  | 'ignored_active_run';

export interface RouteInput {
  event: TicketEvent;
  project: { id: string; maxRunsPerTicket: number };
  rules: RuleRow[];
  /** Fetches the ticket; called at most once, and only when the kind is unknown or the rule filters on labels. */
  ticket: () => Promise<Ticket>;
  counts: { runsForTicket: number; activeSkillsOnTicket: string[] };
  botLogin: string;
}

export type RouteDecision =
  | { kind: 'run'; rule: RuleRow; ticket: Ticket | null; command: string; args: string }
  | { kind: 'ignored'; outcome: IgnoredOutcome; detail: string };

const AUTHORIZED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const ignored = (outcome: IgnoredOutcome, detail: string): RouteDecision => ({ kind: 'ignored', outcome, detail });

/** Pure routing over (event, project, rules, run counts). Steps follow control-plane design 6.1 / Architecture 4. */
export async function routeEvent(input: RouteInput): Promise<RouteDecision> {
  const { event, project, rules, counts, botLogin } = input;

  const parsed = parseCommand(event.body);
  if (!parsed) return ignored('ignored_no_command', 'first line is not a command');

  const isBot = botLogin !== '' && event.author === botLogin;
  if (!isBot && !AUTHORIZED_ASSOCIATIONS.has(event.authorAssociation)) {
    return ignored('ignored_unauthorized', `author association ${event.authorAssociation || 'unknown'} is not allowed`);
  }

  const rule = rules.find((r) => r.command === parsed.command);
  if (!rule) return ignored('ignored_no_rule', `no rule for /${parsed.command}`);
  if (!rule.enabled) return ignored('ignored_rule_disabled', `rule for /${parsed.command} is disabled`);

  let fetched: Promise<Ticket> | undefined;
  const getTicket = (): Promise<Ticket> => (fetched ??= input.ticket());

  let ticket: Ticket | null = null;
  let kind: TicketKind | undefined = event.ticketKind;
  if (kind === undefined || rule.labelFilter.length > 0) {
    ticket = await getTicket();
    kind ??= ticket.kind;
  }

  if (rule.target !== 'any' && rule.target !== kind) {
    return ignored('ignored_target', `rule targets ${rule.target}, ticket is ${kind}`);
  }

  if (rule.labelFilter.length > 0) {
    const have = new Set((ticket?.labels ?? []).map((l) => l.name.toLowerCase()));
    const missing = rule.labelFilter.filter((l) => !have.has(l.toLowerCase()));
    if (missing.length > 0) return ignored('ignored_labels', `missing labels: ${missing.join(', ')}`);
  }

  if (counts.runsForTicket >= project.maxRunsPerTicket) {
    return ignored('ignored_max_runs', `ticket has ${counts.runsForTicket} of ${project.maxRunsPerTicket} runs`);
  }
  if (counts.activeSkillsOnTicket.includes(rule.skillName)) {
    return ignored('ignored_active_run', `skill ${rule.skillName} already has an active run on this ticket`);
  }

  return { kind: 'run', rule, ticket, command: parsed.command, args: parsed.args };
}
