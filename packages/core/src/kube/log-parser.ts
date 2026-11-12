export type LogLineKind = 'session_started' | 'turn_finished' | 'scrollback_begin' | 'scrollback_end' | 'text';

export interface ParsedLogLine {
  kind: LogLineKind;
  text: string;
}

/** The runner's stdout protocol (spec §8). A marker must be the whole line (surrounding whitespace ignored). */
const MARKERS: Record<string, Exclude<LogLineKind, 'text'>> = {
  'agentdesk: session started': 'session_started',
  'agentdesk: turn finished': 'turn_finished',
  'agentdesk: final scrollback begin': 'scrollback_begin',
  'agentdesk: final scrollback end': 'scrollback_end',
};

export function parseLogLine(line: string): ParsedLogLine {
  const trimmed = line.trim();
  const kind = Object.hasOwn(MARKERS, trimmed) ? MARKERS[trimmed] : undefined;
  return kind ? { kind, text: trimmed } : { kind: 'text', text: line };
}
