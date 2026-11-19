import type { AgentKind } from '@agentdesk/contracts';
import { createClaudeAdapter } from './claude';
import type { AgentAdapter, AgentHttpGet } from './types';

export function agentAdapterFor(kind: AgentKind, opts: { http?: AgentHttpGet } = {}): AgentAdapter {
  switch (kind) {
    case 'claude':
      return createClaudeAdapter(opts.http);
    default: {
      const unreachable: never = kind;
      throw new Error(`unknown agent kind: ${String(unreachable)}`);
    }
  }
}
