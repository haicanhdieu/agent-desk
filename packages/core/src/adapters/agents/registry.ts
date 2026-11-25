import { AgentKind } from '@agentdesk/contracts';
import { createClaudeAdapter } from './claude';
import type { AgentAdapter, AgentHttpGet } from './types';

export function agentAdapterFor(kind: AgentKind, opts: { http?: AgentHttpGet } = {}): AgentAdapter {
  switch (kind) {
    case 'claude':
      return createClaudeAdapter(opts.http);
    case 'codex':
    case 'opencode':
      throw new Error('adapter not available yet');
    default: {
      const unreachable: never = kind;
      throw new Error(`unknown agent kind: ${String(unreachable)}`);
    }
  }
}

/** The distinct price providers of every agent kind. */
export function pricingProviders(): string[] {
  // Task 8 replaces the codex/opencode stand-ins; until then only claude has an adapter.
  const kinds = AgentKind.options.filter((k) => k === 'claude');
  const providers = kinds.flatMap((k) => agentAdapterFor(k).pricing?.provider ?? []);
  return [...new Set(providers)];
}
