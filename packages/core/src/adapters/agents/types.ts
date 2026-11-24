import type { AgentKind, AgentModelOption, CredentialType } from '@agentdesk/contracts';

export type AgentModelsErrorKind = 'unreachable' | 'rejected' | 'invalid';

/** Message is `agent models: <kind>` only; never an upstream body, credential, header or cause. */
export class AgentModelsError extends Error {
  readonly kind: AgentModelsErrorKind;
  constructor(kind: AgentModelsErrorKind) {
    super(`agent models: ${kind}`);
    this.name = 'AgentModelsError';
    this.kind = kind;
  }
}

/** Injectable GET; the default is `(url, headers, opts) => guardedGetJson(url, { headers, ...opts })`. */
export type AgentHttpGet = (
  url: URL,
  headers: Record<string, string>,
  /** Time left in the overall list budget; the transport must not wait longer. */
  opts?: { timeoutMs: number },
) => Promise<{ status: number; json: unknown }>;

/** Which price catalog provider an agent's models are priced under. Never holds rates. */
export interface AgentPricing {
  provider: string;
  /** Maps a model id the agent reports to the catalog key; the core default applies when absent. */
  modelKey?(model: string): string;
}

export interface AgentAdapter {
  kind: AgentKind;
  builtinModels: readonly AgentModelOption[];
  pricing?: AgentPricing;
  credentialEnv(type: CredentialType): string;
  launchEnv(input: { model: string; baseUrl: string | null }): { name: string; value: string }[];
  listModels(input: {
    credential: { type: CredentialType; value: string };
    baseUrl: string | null;
  }): Promise<AgentModelOption[]>;
}
