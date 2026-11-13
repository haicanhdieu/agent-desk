export type LogLineKind =
  | 'session_started'
  | 'turn_started'
  | 'turn_finished'
  | 'scrollback_begin'
  | 'scrollback_end'
  | 'checkout'
  | 'plugins_begin'
  | 'plugin_installed'
  | 'plugin_skipped'
  | 'plugin_failed'
  | 'plugins_end'
  | 'setup_begin'
  | 'setup_skipped'
  | 'setup_passed'
  | 'setup_failed'
  | 'setup_timed_out'
  | 'setup_output'
  | 'plugin_output'
  | 'text';

export interface ParsedLogLine {
  kind: LogLineKind;
  text: string;
  pluginId?: string;
  exitCode?: number;
  sha?: string;
}

/** The runner's stdout protocol (spec §8). A marker must be the whole line (surrounding whitespace ignored). */
const MARKERS: Record<string, Exclude<LogLineKind, 'text'>> = {
  'agentdesk: session started': 'session_started',
  'agentdesk: turn started': 'turn_started',
  'agentdesk: turn finished': 'turn_finished',
  'agentdesk: final scrollback begin': 'scrollback_begin',
  'agentdesk: final scrollback end': 'scrollback_end',
  'agentdesk: plugins begin': 'plugins_begin',
  'agentdesk: plugins end': 'plugins_end',
  'agentdesk: setup begin': 'setup_begin',
  'agentdesk: setup skipped (no script)': 'setup_skipped',
  'agentdesk: setup passed': 'setup_passed',
  'agentdesk: setup timed out': 'setup_timed_out',
};

/** `<plugin>@<store>`, each part a slug (same rule as the runner). Anchored, so repo text cannot smuggle extras. */
const ID = '[a-z0-9][a-z0-9-]{0,63}@[a-z0-9][a-z0-9-]{0,63}';
const CHECKOUT = /^agentdesk: checkout ([0-9a-f]{40})$/;
const PLUGIN = new RegExp(`^agentdesk: plugin (installed|failed) (${ID})$`);
const PLUGIN_SKIPPED = new RegExp(`^agentdesk: plugin skipped (${ID}) \\(store not approved\\)$`);
const SETUP_FAILED = /^agentdesk: setup failed exit=(\d{1,3})$/;

const PLUGIN_KINDS = { installed: 'plugin_installed', failed: 'plugin_failed' } as const;

export function parseLogLine(line: string): ParsedLogLine {
  if (line.startsWith('setup| ')) return { kind: 'setup_output', text: line.slice('setup| '.length) };
  if (line.startsWith('plugin| ')) return { kind: 'plugin_output', text: line.slice('plugin| '.length) };
  const trimmed = line.trim();
  const kind = Object.hasOwn(MARKERS, trimmed) ? MARKERS[trimmed] : undefined;
  if (kind) return { kind, text: trimmed };
  const checkout = CHECKOUT.exec(trimmed);
  if (checkout?.[1]) return { kind: 'checkout', text: trimmed, sha: checkout[1] };
  const plugin = PLUGIN.exec(trimmed);
  if (plugin?.[1] === 'installed' || plugin?.[1] === 'failed') {
    return { kind: PLUGIN_KINDS[plugin[1]], text: trimmed, pluginId: plugin[2] };
  }
  const skipped = PLUGIN_SKIPPED.exec(trimmed);
  if (skipped) return { kind: 'plugin_skipped', text: trimmed, pluginId: skipped[1] };
  const failed = SETUP_FAILED.exec(trimmed);
  if (failed?.[1]) return { kind: 'setup_failed', text: trimmed, exitCode: Number.parseInt(failed[1], 10) };
  return { kind: 'text', text: line };
}
