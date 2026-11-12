// `\s` followed by `.*` is equivalent to the contract regex `^/([a-z0-9-]+)(\s+.*)?$` (`\s+.*` matches exactly when `\s.*`
// does) but has no overlapping quantifiers, so it cannot backtrack quadratically.
const COMMAND = /^\/([a-z0-9-]+)(?:\s(.*))?$/;

// The first line is cut at every line terminator `.` refuses (CR, LF, U+2028, U+2029), so the matched text never contains
// one: `.` and `\s` then agree and the regex cannot fail late.
const LINE_BREAK = /\r\n|[\r\n\u2028\u2029]/;

// The parse runs before authorization on attacker-controlled text. No real command line comes close to this length,
// so anything longer is rejected outright to bound the work.
const MAX_FIRST_LINE = 1000;

/**
 * Parses the first line of a comment. `args` is the rest of that line, trimmed and otherwise uninterpreted:
 * it is untrusted text and must never reach a shell, SQL or a Kubernetes spec unescaped.
 */
export function parseCommand(body: string): { command: string; args: string } | null {
  const firstLine = body.split(LINE_BREAK, 1)[0] ?? '';
  if (firstLine.length > MAX_FIRST_LINE) return null;
  const m = COMMAND.exec(firstLine);
  if (!m?.[1]) return null;
  return { command: m[1], args: (m[2] ?? '').trim() };
}
