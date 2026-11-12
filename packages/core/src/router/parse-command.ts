const COMMAND = /^\/([a-z0-9-]+)(\s+.*)?$/;

/**
 * Parses the first line of a comment. `args` is the rest of that line, trimmed and otherwise uninterpreted:
 * it is untrusted text and must never reach a shell, SQL or a Kubernetes spec unescaped.
 */
export function parseCommand(body: string): { command: string; args: string } | null {
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const m = COMMAND.exec(firstLine);
  if (!m?.[1]) return null;
  return { command: m[1], args: (m[2] ?? '').trim() };
}
