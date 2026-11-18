import type { AgentDto, ProjectDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { agentFixtures } from '@/mocks/dto/agents';
import { projectFixtures } from '@/mocks/dto/projects';
import { hasLimitChanges, limitsOf, limitsRequests, toAgentSettings } from './agent.form';

const now = new Date('2026-11-12T14:14:00.000Z');

function fixture<T>(list: T[]): T {
  const first = list[0];
  if (!first) throw new Error('no fixture');
  return first;
}
const agent: AgentDto = fixture(agentFixtures);
const project: ProjectDto = fixture(projectFixtures);
const base = limitsOf(agent, project);

describe('toAgentSettings', () => {
  it('maps seconds to minutes and the credential to a relative "set at" and who set it', () => {
    expect(toAgentSettings(agent, project, now)).toEqual({
      agent: 'Claude',
      model: 'opus',
      credential: { type: 'oauth_token', setAt: '12 Oct', setBy: 'kim-hale' },
      timeoutMinutes: 30,
      pausedKeepMinutes: 10080,
      doneKeepMinutes: 1440,
      idleEndMinutes: 30,
      maxConcurrent: 2,
      maxRunsPerTicket: 10,
    });
  });

  it('no credential yet: empty set-at and set-by', () => {
    const unset = { ...agent, credential: { set: false, type: null, updatedAt: null, setBy: null } };
    expect(toAgentSettings(unset, project, now).credential).toEqual({ type: 'oauth_token', setAt: '', setBy: '' });
  });
});

describe('limitsRequests', () => {
  it('nothing changed → nothing to send', () => {
    expect(limitsRequests(base, { ...base })).toEqual({});
    expect(hasLimitChanges(limitsRequests(base, { ...base }))).toBe(false);
  });

  it('the idle end comes from the agent, in minutes', () => {
    expect(limitsOf({ ...agent, idleEndSeconds: 5400 }, project).idleEndMinutes).toBe(90);
  });

  it('a changed idle end is sent in seconds, with the other changed limits', () => {
    const req = limitsRequests(base, { ...base, maxRunsPerTicket: 20, idleEndMinutes: 15 });
    expect(req).toEqual({ project: { maxRunsPerTicket: 20 }, idleEndSeconds: 900 });
    expect(hasLimitChanges(limitsRequests(base, { ...base, idleEndMinutes: 15 }))).toBe(true);
  });

  it('an unchanged idle end is not sent', () => {
    expect(limitsRequests(base, { ...base, idleEndMinutes: base.idleEndMinutes })).toEqual({});
  });

  it('a changed timeout is sent in seconds', () => {
    expect(limitsRequests(base, { ...base, timeoutMinutes: 60, maxConcurrent: 3 })).toEqual({
      project: { maxConcurrentRuns: 3 },
      timeoutSeconds: 3600,
    });
  });
});

describe('limitsRequests keep times', () => {
  it('a changed paused keep time is sent in seconds', () => {
    expect(limitsRequests(base, { ...base, pausedKeepMinutes: 3 * 1440 })).toEqual({ pausedKeepSeconds: 259200 });
  });

  it('a finished-run keep time of 0 is sent as 0 (no session kept)', () => {
    expect(limitsRequests(base, { ...base, doneKeepMinutes: 0 })).toEqual({ doneKeepSeconds: 0 });
    expect(hasLimitChanges(limitsRequests(base, { ...base, doneKeepMinutes: 0 }))).toBe(true);
  });
});
