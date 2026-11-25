import { AGENT_KIND_CAPABILITIES, AgentKind, type AgentDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { agentsFixture } from '@/mocks/dto/agents';
import { credentialDetail } from './map';

const base = agentsFixture[0];
if (!base) throw new Error('agent fixture missing');

const agentOf = (provider: AgentKind, model: string, set = true): AgentDto => ({
  ...base,
  provider,
  model,
  credential: set
    ? { set: true, type: AGENT_KIND_CAPABILITIES[provider].credentialTypes[0]?.type ?? null, updatedAt: null, setBy: null }
    : { set: false, type: null, updatedAt: null, setBy: null },
});

describe('credentialDetail', () => {
  it.each(AgentKind.options)('%s with a model reads "<label>, <model>" from the capability table', (kind) => {
    expect(credentialDetail(agentOf(kind, 'some-model'))).toBe(`${AGENT_KIND_CAPABILITIES[kind].label}, some-model`);
  });

  it('uses the model it is given over the agent row', () => {
    expect(credentialDetail(agentOf('codex', 'old'), 'gpt-6-sol')).toBe('OpenAI Codex, gpt-6-sol');
  });

  it('OpenCode with a model reads "OpenCode, <model>"', () => {
    expect(credentialDetail(agentOf('opencode', 'anthropic/claude-sonnet-4-5'))).toBe(
      'OpenCode, anthropic/claude-sonnet-4-5',
    );
  });

  it('OpenCode with no model reads "OpenCode", with or without a credential', () => {
    expect(credentialDetail(agentOf('opencode', ''))).toBe('OpenCode');
    expect(credentialDetail(agentOf('opencode', '', false))).toBe('OpenCode');
  });

  it.each(['claude', 'codex'] as const)('%s with no credential has no detail', (kind) => {
    expect(credentialDetail(agentOf(kind, 'm', false))).toBeUndefined();
  });
});
