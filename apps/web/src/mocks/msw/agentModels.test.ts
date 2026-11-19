import type { AgentDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { agentModelsFixtures } from '../dto/agentModels';
import { agentFixtures } from '../dto/agents';
import { agentModelsAnswer, type AgentModelsScenario } from './agentModels';

const base = agentFixtures.find((a) => a.credential.set);
if (!base) throw new Error('no agent fixture with a credential');
const withCredential: AgentDto = { ...base, baseUrl: null };
const withoutCredential: AgentDto = {
  ...base,
  credential: { set: false, type: null, updatedAt: null, setBy: null },
};

describe('agentModelsAnswer', () => {
  it('defaults to the standard names when the agent has no credential', () => {
    expect(agentModelsAnswer(withoutCredential, undefined, false)).toEqual(agentModelsFixtures.noCredential);
    expect(agentModelsFixtures.noCredential.models.map((m) => m.id)).toEqual(['opus', 'sonnet', 'haiku']);
  });

  it('defaults to the live fixture when the agent has a credential', () => {
    expect(agentModelsAnswer(withCredential, undefined, false)).toEqual(agentModelsFixtures.live);
  });

  it('answers a live scenario with its ids, label equal to id', () => {
    expect(agentModelsAnswer(withCredential, { kind: 'live', ids: ['m-1', 'm-2'] }, false)).toEqual({
      source: 'live',
      reason: null,
      models: [
        { id: 'm-1', label: 'm-1' },
        { id: 'm-2', label: 'm-2' },
      ],
    });
  });

  it('a live scenario still answers no_credential while the agent has none', () => {
    expect(agentModelsAnswer(withoutCredential, { kind: 'live', ids: ['m-1'] }, false)).toEqual(
      agentModelsFixtures.noCredential,
    );
  });

  it('applies fallback, error and pending scenarios to an agent without a credential', () => {
    expect(agentModelsAnswer(withoutCredential, { kind: 'fallback', reason: 'disabled' }, false)).toEqual(
      agentModelsFixtures.disabled,
    );
    expect(agentModelsAnswer(withoutCredential, { kind: 'error' }, false)).toBe('error');
    expect(agentModelsAnswer(withoutCredential, { kind: 'pending' }, false)).toBe('pending');
  });

  it('applies beforeCredentialSave fallback to an agent without a credential', () => {
    const scenario: AgentModelsScenario = {
      kind: 'live',
      ids: ['after'],
      beforeCredentialSave: { kind: 'fallback', reason: 'unreachable' },
    };
    expect(agentModelsAnswer(withoutCredential, scenario, false)).toEqual(agentModelsFixtures.unreachable);
  });

  it('picks the list by the agent address, with the empty key for no address', () => {
    const scenario: AgentModelsScenario = {
      kind: 'live',
      ids: ['fallback'],
      idsByBaseUrl: { '': ['plain'], 'https://gw.example.com': ['gw-1'] },
    };
    const ids = (a: AgentDto) => {
      const answer = agentModelsAnswer(a, scenario, false);
      return typeof answer === 'object' ? answer.models.map((m) => m.id) : answer;
    };
    expect(ids(withCredential)).toEqual(['plain']);
    expect(ids({ ...withCredential, baseUrl: 'https://gw.example.com' })).toEqual(['gw-1']);
    expect(ids({ ...withCredential, baseUrl: 'https://other.example.com' })).toEqual(['fallback']);
  });

  it('applies beforeCredentialSave until a credential was saved', () => {
    const scenario: AgentModelsScenario = {
      kind: 'live',
      ids: ['after'],
      beforeCredentialSave: { kind: 'fallback', reason: 'rejected' },
    };
    expect(agentModelsAnswer(withCredential, scenario, false)).toEqual(agentModelsFixtures.rejected);
    expect(agentModelsAnswer(withCredential, scenario, true)).toMatchObject({ source: 'live' });
  });

  it('maps fallback, error and pending as typed', () => {
    expect(agentModelsAnswer(withCredential, { kind: 'fallback', reason: 'unreachable' }, false)).toEqual(
      agentModelsFixtures.unreachable,
    );
    expect(agentModelsAnswer(withCredential, { kind: 'fallback', reason: 'disabled' }, false)).toEqual(
      agentModelsFixtures.disabled,
    );
    expect(agentModelsAnswer(withCredential, { kind: 'error' }, false)).toBe('error');
    expect(agentModelsAnswer(withCredential, { kind: 'pending' }, false)).toBe('pending');
  });
});
