import { AGENT_KIND_CAPABILITIES, AGENT_KINDS_COMING_SOON, AgentKind, type AgentDto } from '@agentdesk/contracts';
import { agentsFixture } from './dto/agents';
import type { AgentRowView, AgentSettings, AgentStatusView, ProviderPickerOptions } from './types';

const AGENT_KINDS = AgentKind.options;

// Prototype board: DeskAgent (Agent, Credential, Limits).
export const agentSettings: AgentSettings = {
  agent: 'Claude',
  model: 'claude-opus-4-5-20251101',
  baseUrl: '',
  credential: {
    type: 'oauth_token',
    setAt: '12 Oct 2026',
    setBy: 'kim-hale',
    status: { tone: 'err', text: 'Rejected at 11:29' },
  },
  timeoutMinutes: 30,
  pausedKeepMinutes: 10080,
  doneKeepMinutes: 1440,
  idleEndMinutes: 30,
  maxConcurrent: 2,
  maxRunsPerTicket: 10,
  autoResumeMax: 5,
};

const AUTH_LABEL_OPENCODE_NONE = 'No sign-in';

/** The row status words of the spec (UI/UX words); `no_credential` reads differently for a provider that needs none. */
export function agentStatusView(a: AgentDto): AgentStatusView {
  const cap = AGENT_KIND_CAPABILITIES[a.provider];
  if (!a.credential.set) {
    return cap.credentialOptional ? { tone: 'off', text: 'No credential' } : { tone: 'warn', text: 'Needs credential' };
  }
  switch (a.lastTest?.status) {
    case undefined:
      return { tone: 'off', text: 'Not tested' };
    case 'ok':
      return { tone: 'ok', text: 'Ready' };
    case 'rejected':
      return { tone: 'err', text: 'Credential rejected' };
    case 'unreachable':
      return { tone: 'err', text: "Can't reach address" };
    case 'invalid':
      return { tone: 'warn', text: "Can't verify" };
    case 'unsupported':
      return { tone: 'off', text: 'Not checkable' };
  }
}

/** One row as the list draws it, built from a DTO with the contracts capability table. */
export function agentRowView(a: AgentDto): AgentRowView {
  const cap = AGENT_KIND_CAPABILITIES[a.provider];
  const auth = a.credential.type
    ? (cap.credentialTypes.find((c) => c.type === a.credential.type)?.label ?? null)
    : cap.credentialOptional
      ? AUTH_LABEL_OPENCODE_NONE
      : null;
  const parts = a.provider === 'opencode' ? [cap.label, auth] : [cap.label, a.accountLabel, auth];
  return {
    id: a.id,
    name: a.name,
    logo: cap.logo,
    detail: parts.filter((p): p is string => p !== null && p !== '').join(' . '),
    model: a.model,
    isDefault: a.isDefault,
    status: agentStatusView(a),
  };
}

export const agentRowViews: AgentRowView[] = agentsFixture.map(agentRowView);

/** The provider picker: the runnable capability rows, then the Coming-soon ids. */
export const providerPickerOptions: ProviderPickerOptions = {
  runnable: AGENT_KINDS.map((kind) => ({
    kind,
    label: AGENT_KIND_CAPABILITIES[kind].label,
    logo: AGENT_KIND_CAPABILITIES[kind].logo,
  })),
  comingSoon: AGENT_KINDS_COMING_SOON.map(({ id, label, logo }) => ({ id, label, logo })),
};
