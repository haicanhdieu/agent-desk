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

export interface AgentAdapter {
  kind: AgentKind;
  builtinModels: readonly AgentModelOption[];
  credentialEnv(type: CredentialType): string;
  launchEnv(input: { model: string; baseUrl: string | null }): { name: string; value: string }[];
  listModels(input: {
    credential: { type: CredentialType; value: string };
    baseUrl: string | null;
  }): Promise<AgentModelOption[]>;
}
