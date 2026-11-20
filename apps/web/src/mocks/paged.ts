import type { ScriptVersion } from '@/components/VersionHistory';
import type { RunStatus } from '@/ds/tokens';
import { bot, user } from './projects';
import { connections } from './connection';
import type { IgnoredCommand, Label, Project, Rule, RunSummary, Skill, Ticket } from './types';

// Deterministic list fixtures for the paged, empty and loading stories: newest first, `total` rows, no randomness.
const GH = 'https://github.com/';
const story: Label = { name: 'user-story', color: '#7C8FD8' };

const endedStatuses: RunStatus[] = ['succeeded', 'succeeded', 'failed', 'cancelled', 'timed_out'];
const commands = ['code-build', 'code-review', 'code-e2e'] as const;
const pad = (n: number) => String(n).padStart(2, '0');

/** Runs numbered total..1. Runs `ticketSize` apart share a ticket, so a ticket can continue across pages. */
export function pagedRuns(total: number, opts: { ticketSize?: number } = {}): RunSummary[] {
  const ticketSize = opts.ticketSize ?? 2;
  return Array.from({ length: total }, (_, i): RunSummary => {
    const id = total - i;
    const ticketNumber = Math.ceil(id / ticketSize);
    const skill = commands[id % commands.length];
    const ticket: Ticket = {
      kind: skill === 'code-review' ? 'pr' : 'issue',
      number: ticketNumber,
      title: `Ticket ${ticketNumber}: add a health check endpoint`,
      labels: [story],
      state: 'Open',
      href: GH,
    };
    return {
      id,
      status: endedStatuses[id % endedStatuses.length],
      command: `/${skill}`,
      skill,
      agent: 'Claude',
      model: 'opus',
      ticket,
      triggeredBy: skill === 'code-review' ? bot : user,
      startedAt: `Mar ${1 + (id % 28)}`,
      duration: `${1 + (id % 29)}m ${pad(id % 60)}s`,
    };
  });
}

const reasons = [
  ['Author has no write access', 'The author is not a collaborator on the repo.'],
  ['Run limit reached', 'This ticket already has 10 runs. Raise the limit or start a new ticket.'],
  ['Already running', 'A run for this ticket is still going.'],
] as const;
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

/** Ignored commands, newest first. */
export function pagedIgnored(total: number): IgnoredCommand[] {
  return Array.from({ length: total }, (_, i): IgnoredCommand => {
    const n = total - i;
    const [reason, detail] = reasons[n % reasons.length];
    return {
      at: `${weekdays[n % weekdays.length]} ${pad(8 + (n % 12))}:${pad((n * 7) % 60)}`,
      ticket: { kind: n % 2 === 0 ? 'pr' : 'issue', number: 100 + n },
      command: `/${commands[n % commands.length]}`,
      author: n % 3 === 0 ? 'octo-visitor' : 'kim-hale',
      reason,
      detail,
      href: GH,
    };
  });
}

/** Idle runs waiting for a person, newest first. */
export function pagedNeedsYou(total: number): { run: RunSummary; href: string; idleAt: string; endsAt: string }[] {
  return pagedRuns(total).map((r) => {
    const minute = r.id % 30;
    return {
      run: { ...r, status: 'idle' as const, startedAt: `09:${pad(minute)}` },
      href: `/runs/${r.id}`,
      idleAt: `09:${pad(minute + 8)}`,
      endsAt: `10:${pad(minute)}`,
    };
  });
}

/** Projects in creation order. */
export function pagedProjects(total: number): Project[] {
  return Array.from({ length: total }, (_, i): Project => {
    const n = i + 1;
    return {
      id: `project-${n}`,
      org: 'harbor-labs',
      name: `project-${pad(n)}`,
      repo: `harbor-labs/project-${pad(n)}`,
      connection: n % 4 === 0 ? connections.pollingOk : connections.webhookOk,
      needsYou: n % 5 === 0 ? 1 : 0,
      running: n % 3 === 0 ? 1 : 0,
      queued: 0,
      lastRun: `Run ${n}, ${n} days ago`,
    };
  });
}

/** Routing rules in creation order; every rule has its own command. */
export function pagedRules(total: number): Rule[] {
  return Array.from({ length: total }, (_, i): Rule => {
    const n = i + 1;
    return {
      id: `rule-${n}`,
      command: `code-task-${pad(n)}`,
      target: n % 2 === 0 ? 'pr' : 'issue',
      labels: [],
      skill: `skill-${pad(n)}`,
      agent: 'Claude',
      enabled: n % 3 !== 0,
      stats: `${n} runs this week, last 14:${pad(n % 60)}`,
    };
  });
}

/** Skills by name. */
export function pagedSkills(total: number): Skill[] {
  return Array.from({ length: total }, (_, i): Skill => {
    const name = `skill-${pad(i + 1)}`;
    return {
      name,
      description: `Does task ${i + 1} end to end.`,
      body: `---\nname: ${name}\ndescription: Does task ${i + 1} end to end.\n---\n\n# Task ${i + 1}\n`,
      ruleSummary: `Used by /code-task-${pad(i + 1)}`,
      path: `.claude/skills/${name}/SKILL.md`,
      lastCommit: `${i + 1} days ago`,
    };
  });
}

/** Setup script versions, newest (highest) first. */
export function pagedVersions(total: number): ScriptVersion[] {
  return Array.from({ length: total }, (_, i): ScriptVersion => {
    const version = total - i;
    return {
      version,
      author: version % 2 === 0 ? 'dana-ortiz' : 'kim-hale',
      ago: `${i + 1} days ago`,
      ...(version > 1 && { note: `Change ${version}` }),
    };
  });
}
