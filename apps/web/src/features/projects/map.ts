import type { ProjectConnectionDto, ProjectDto } from '@agentdesk/contracts';
import type { ConnectionStatus, PollInterval, Project } from '@/mocks/types';
import { relativeTime } from '../relativeTime';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A webhook project that has heard nothing for this long is probably misconfigured. */
const WEBHOOK_SILENT_MS = 2 * DAY_MS;

const POLL_LABELS = {
  300: '5 min',
  600: '10 min',
  900: '15 min',
  1800: '30 min',
} as const satisfies Record<number, PollInterval>;

export function pollIntervalLabel(seconds: 300 | 600 | 900 | 1800): PollInterval {
  return POLL_LABELS[seconds];
}

/** The slice of a project the connection status depends on. */
export interface ConnectionProject {
  triggerMode: ProjectDto['triggerMode'];
  pollIntervalSeconds: ProjectDto['pollIntervalSeconds'];
  createdAt: string;
}

export function toConnectionStatus(dto: ProjectConnectionDto, project: ConnectionProject, now: Date): ConnectionStatus {
  if (dto.mode === 'polling') {
    const polling = dto.polling;
    if (polling?.pausedReason === 'token_revoked') {
      return {
        mode: 'polling',
        tone: 'err',
        text: 'Polling failed: token revoked',
      };
    }
    if (polling?.pausedReason)
      return {
        mode: 'polling',
        tone: 'err',
        text: `Polling failed: ${polling.pausedReason}`,
      };
    if (polling?.lastError)
      return {
        mode: 'polling',
        tone: 'err',
        text: `Polling failed: ${polling.lastError}`,
      };
    const seconds = polling?.intervalSeconds ?? project.pollIntervalSeconds;
    return {
      mode: 'polling',
      tone: 'ok',
      text: `Polling every ${pollIntervalLabel(seconds)}`,
    };
  }
  // With no event yet, the project's age stands in for "time since the last event".
  const since = dto.webhook?.lastEventAt ?? project.createdAt;
  if (now.getTime() - new Date(since).getTime() >= WEBHOOK_SILENT_MS) {
    return { mode: 'webhook', tone: 'warn', text: 'No webhooks for 2 days' };
  }
  return { mode: 'webhook', tone: 'ok', text: 'Connected' };
}

export function toProject(dto: ProjectDto, connection: ConnectionStatus, org: string, now: Date): Project {
  return {
    id: dto.id,
    org,
    name: dto.name,
    repo: dto.repoPath,
    connection,
    needsYou: dto.counts.needsYou,
    // counts.running includes idle runs (needsYou); the projects list shows them once, under needs you.
    running: Math.max(0, dto.counts.running - dto.counts.needsYou),
    queued: dto.counts.queued,
    lastRun: dto.lastRunAt ? relativeTime(dto.lastRunAt, now) : '—',
  };
}
