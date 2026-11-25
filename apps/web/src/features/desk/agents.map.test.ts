import type { AgentDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { agentsFixture } from '@/mocks/dto/agents';
import { toAgentRowView } from './agents.map';

const claude: AgentDto = {
  ...(agentsFixture[0] as AgentDto),
  name: 'Claude - Work',
  provider: 'claude',
  accountLabel: 'work@harbor.example',
  isDefault: true,
  credential: { set: true, type: 'oauth_token', updatedAt: '2026-11-01T10:00:00.000Z', setBy: 'kim-hale' },
  lastTest: { status: 'ok', at: '2026-11-02T10:00:00.000Z' },
};

describe('toAgentRowView', () => {
  it('shows the name, provider, account, sign-in, model, default flag and the Ready status', () => {
    expect(toAgentRowView(claude)).toEqual({
      id: claude.id,
      name: 'Claude - Work',
      logo: 'claude',
      providerLabel: 'Claude Code',
      detail: 'Claude Code . work@harbor.example . Subscription token',
      model: claude.model,
      isDefault: true,
      status: { tone: 'ok', text: 'Ready' },
    });
  });

  it('a rejected credential reads "Credential rejected" in the error tone', () => {
    const row = toAgentRowView({ ...claude, lastTest: { status: 'rejected', at: '2026-11-02T10:00:00.000Z' } });
    expect(row.status).toEqual({ tone: 'err', text: 'Credential rejected' });
  });

  it('OpenCode with no credential reads "No credential" and "No sign-in", neutral', () => {
    const row = toAgentRowView({
      ...claude,
      provider: 'opencode',
      accountLabel: null,
      isDefault: false,
      credential: { set: false, type: null, updatedAt: null, setBy: null },
      lastTest: null,
    });
    expect(row.detail).toBe('OpenCode . No sign-in');
    expect(row.status).toEqual({ tone: 'off', text: 'No credential' });
    expect(row.isDefault).toBe(false);
  });

  it('Claude with no credential needs one', () => {
    const row = toAgentRowView({ ...claude, credential: { set: false, type: null, updatedAt: null, setBy: null } });
    expect(row.status).toEqual({ tone: 'warn', text: 'Needs credential' });
  });
});
