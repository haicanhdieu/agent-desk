import type { AgentKind, AgentModelOption, AgentTestStatus, CredentialType } from '@agentdesk/contracts';

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

/** Outcome of a connection check; the same words as the contract's agent test status. */
export type AgentConnectionStatus = AgentTestStatus;

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
  /** The runner env var for a credential type, or null for a type the kind delivers as a file. */
  credentialEnv(type: CredentialType): string | null;
  launchEnv(input: {
    model: string;
    baseUrl: string | null;
    /** Ignored by claude and codex; opencode needs it to tell its own-endpoint type from the others. */
    credentialType: CredentialType | null;
  }): { name: string; value: string }[];
  listModels(input: {
    credential: { type: CredentialType; value: string };
    baseUrl: string | null;
  }): Promise<AgentModelOption[]>;
  /** Never throws and never carries the credential; every failure is one of the status words. */
  checkConnection(input: {
    credential: { type: CredentialType; value: string } | null;
    baseUrl: string | null;
  }): Promise<AgentConnectionStatus>;
}
