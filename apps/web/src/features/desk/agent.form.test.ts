import type { AgentDto, ProjectDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { agentFixtures } from '@/mocks/dto/agents';
import { projectFixtures } from '@/mocks/dto/projects';
import { IDLE_END_MINUTES, limitsOf, limitsRequests, toAgentSettings } from './agent.form';

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
      idleEndMinutes: IDLE_END_MINUTES,
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
  });

  it('only changed project limits go to the project; the idle field is never sent', () => {
    expect(limitsRequests(base, { ...base, maxRunsPerTicket: 20, idleEndMinutes: 15 })).toEqual({
      project: { maxRunsPerTicket: 20 },
    });
  });

  it('a changed timeout is sent in seconds', () => {
    expect(limitsRequests(base, { ...base, timeoutMinutes: 60, maxConcurrent: 3 })).toEqual({
      project: { maxConcurrentRuns: 3 },
      timeoutSeconds: 3600,
    });
  });
});
