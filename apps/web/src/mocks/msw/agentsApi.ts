import {
  AGENT_KIND_CAPABILITIES,
  FINAL_RUN_STATUSES,
  AGENT_TEST_MESSAGES,
  type AgentConnectionDto,
  type AgentDto,
  type AgentKind,
  type CreateAgentRequest,
  type OrgChecklistDto,
  type PutCredentialRequest,
  type UpdateAgentRequest,
} from '@agentdesk/contracts';
import { projectFixtures } from '../dto/projects';
import { mockDb } from './db';
import { Problem, conflict } from './http';

// The agent configuration routes on the mock store (the API's rules, spec 2026-11-24 multi-agent configs). The
// handlers in handlers.ts do the session and tenant scoping, then call these with a project or agent already in scope.

const now = () => new Date().toISOString();
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const unprocessable = (title: string, pointer: string, detail: string) =>
  new Problem({ status: 422, title, type: 'validation', errors: [{ pointer, detail }] });

/** The model a new agent starts with when none is named: the adapter's first built-in model (empty for OpenCode). */
const FIRST_MODEL: Record<AgentKind, string> = { claude: 'opus', codex: 'gpt-5-codex', opencode: '' };

const runnableKinds: readonly string[] = Object.keys(AGENT_KIND_CAPABILITIES);

/** Called with the raw body before parsing: a Coming-soon or unknown provider is 422 on /provider, not a shape error. */
export function refuseUnknownProvider(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null || !('provider' in raw)) return;
  if (typeof raw.provider === 'string' && runnableKinds.includes(raw.provider)) return;
  throw unprocessable('Provider not available', '/provider', 'This provider is not available yet.');
}

/** The project's agents, the default first, then in creation order. */
export function agentsOf(projectId: string): AgentDto[] {
  const mine = mockDb.state.agents.filter((a) => a.projectId === projectId);
  return [...mine.filter((a) => a.isDefault), ...mine.filter((a) => !a.isDefault)];
}

/**
 * The checklist of a project the setup wizard created in the mock: "Add an agent" is done when the project's default
 * agent is ready (it has a credential, or its kind runs without one), as the API reads it. The fixture projects keep
 * their stored checklist (the onboarding scenarios set it); "Add a rule" stays as stored.
 */
export function checklistOf(stored: OrgChecklistDto): OrgChecklistDto {
  const projectId = stored.projectId;
  if (projectId === null || projectFixtures.some((p) => p.id === projectId)) return stored;
  const lead = agentsOf(projectId)[0];
  const ready =
    lead !== undefined &&
    lead.isDefault &&
    (lead.credential.set || AGENT_KIND_CAPABILITIES[lead.provider].credentialOptional);
  const steps = stored.steps.map((s) => (s.key === 'add_agent' ? { ...s, done: ready } : s));
  return { ...stored, steps, complete: steps.every((s) => s.done) };
}

const takenName = (projectId: string, name: string, exceptId?: string) =>
  mockDb.state.agents.some((a) => a.projectId === projectId && a.id !== exceptId && sameName(a.name, name));

const duplicateName = () =>
  conflict('Name already exists', [{ pointer: '/name', detail: 'Another agent in this project has this name.' }]);

export function createAgent(
  project: { id: string } & Pick<
    AgentDto,
    'timeoutSeconds' | 'pausedKeepSeconds' | 'doneKeepSeconds' | 'idleEndSeconds' | 'autoResumeMax'
  >,
  body: CreateAgentRequest,
): AgentDto {
  if (takenName(project.id, body.name)) throw duplicateName();
  const hasDefault = mockDb.state.agents.some((a) => a.projectId === project.id && a.isDefault);
  const agent: AgentDto = {
    id: mockDb.nextId(),
    projectId: project.id,
    name: body.name,
    provider: body.provider,
    model: body.model ?? FIRST_MODEL[body.provider],
    baseUrl: null,
    maxTurns: body.maxTurns ?? null,
    timeoutSeconds: project.timeoutSeconds,
    pausedKeepSeconds: project.pausedKeepSeconds,
    doneKeepSeconds: project.doneKeepSeconds,
    idleEndSeconds: project.idleEndSeconds,
    autoResumeMax: project.autoResumeMax,
    credential: { set: false, type: null, updatedAt: null, setBy: null },
    accountLabel: body.accountLabel ?? null,
    // The server decides: the first agent of a project with no default becomes the default, never otherwise.
    isDefault: !hasDefault,
    lastTest: null,
    usage: { rules: 0, blockingRuns: 0 },
  };
  mockDb.state.agents.push(agent);
  return agent;
}

export function updateAgent(agent: AgentDto, body: UpdateAgentRequest): AgentDto {
  if (body.name !== undefined && takenName(agent.projectId, body.name, agent.id)) throw duplicateName();
  if (body.model === '' && !AGENT_KIND_CAPABILITIES[agent.provider].modelOptional) {
    throw unprocessable('Model required', '/model', 'Enter a model for this agent.');
  }
  if (body.name !== undefined) agent.name = body.name;
  if (body.accountLabel !== undefined) agent.accountLabel = body.accountLabel;
  if (body.model !== undefined) agent.model = body.model;
  if (body.maxTurns !== undefined) agent.maxTurns = body.maxTurns;
  return agent;
}

export function setDefaultAgent(agent: AgentDto): AgentDto {
  for (const a of mockDb.state.agents) if (a.projectId === agent.projectId) a.isDefault = a.id === agent.id;
  return agent;
}

/** Why a delete is refused, in the API's order: the only agent, the default, a rule, an open run; undefined when allowed. */
function deleteRefusal(agent: AgentDto): string | undefined {
  const siblings = mockDb.state.agents.filter((a) => a.projectId === agent.projectId && a.id !== agent.id);
  if (siblings.length === 0) return 'A project needs at least one agent. Add another agent first.';
  if (agent.isDefault) return 'Set another agent as default first';
  const rules = mockDb.state.rules.filter((r) => r.agentId === agent.id);
  const ruleCount = Math.max(rules.length, agent.usage.rules);
  if (ruleCount > 0) {
    const shown = rules
      .map((r) => `/${r.command}`)
      .sort()
      .slice(0, 5);
    const more = ruleCount - shown.length;
    return `${ruleCount} ${ruleCount === 1 ? 'rule names' : 'rules name'} it: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}. Point it at another agent first, then delete.`;
  }
  if (agent.usage.blockingRuns > 0) {
    const run = mockDb.state.runs
      .filter((r) => r.agent.id === agent.id && !(FINAL_RUN_STATUSES as readonly string[]).includes(r.status))
      .sort((a, b) => a.number - b.number)[0];
    if (run) {
      return run.status === 'paused'
        ? `Run ${run.number} is paused and can be resumed. Finish it first, then delete.`
        : `Run ${run.number} is ${run.status}. Finish it first, then delete.`;
    }
    return 'A run still uses this agent. Finish it first, then delete.';
  }
  return undefined;
}

export function removeAgent(agent: AgentDto): null {
  // swapDeleteFails: the wizard's placeholder (the credential-less "Claude") cannot be removed.
  if (mockDb.state.failPlaceholderDelete && agent.name === 'Claude' && !agent.credential.set) {
    throw new Problem({ status: 500, title: 'Internal server error', type: 'internal' });
  }
  const refusal = deleteRefusal(agent);
  if (refusal) throw conflict('Conflict', undefined, refusal);
  mockDb.state.agents = mockDb.state.agents.filter((a) => a.id !== agent.id);
  return null;
}

/** The connection check: no credential, OpenCode (no check for it unless it is a key and an endpoint), or the scenario's answer. */
export function testAgent(agent: AgentDto): AgentConnectionDto {
  const answer = (status: AgentConnectionDto['status']): AgentConnectionDto => ({
    status,
    message: AGENT_TEST_MESSAGES[status],
    testedAt: status === 'no_credential' ? null : now(),
  });
  if (!agent.credential.set) {
    // OpenCode may run with no sign-in at all: nothing to check. Other kinds need a credential.
    return answer(agent.provider === 'opencode' ? 'unsupported' : 'no_credential');
  }
  const unsupported = agent.provider === 'opencode' && agent.credential.type === 'auth_json';
  const status = unsupported ? 'unsupported' : (mockDb.state.agentTestScenario ?? 'ok');
  const result = answer(status);
  if (result.status !== 'no_credential' && result.testedAt !== null) {
    agent.lastTest = { status: result.status, at: result.testedAt };
  }
  return result;
}

/** The credential route's checks for the kind (422 on the field, nothing stored). */
export function checkCredential(agent: AgentDto, body: PutCredentialRequest): void {
  const cap = AGENT_KIND_CAPABILITIES[agent.provider];
  if (!cap.credentialTypes.some((t) => t.type === body.type)) {
    throw unprocessable('Credential type not allowed', '/type', 'This agent does not take that credential type.');
  }
  if (agent.provider !== 'opencode') return;
  if (body.type === 'auth_json') {
    if (typeof body.baseUrl === 'string') {
      throw unprocessable('API address not allowed', '/baseUrl', 'A credentials file takes no API address.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.value);
    } catch {
      parsed = undefined;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw unprocessable('Credentials file not valid', '/value', 'The credentials file must be a JSON object.');
    }
    return;
  }
  const address = body.baseUrl === undefined ? agent.baseUrl : body.baseUrl;
  if (address === null) {
    throw unprocessable('API address required', '/baseUrl', 'Enter the API endpoint for this key.');
  }
}
