// Fake run pod for KUBE_MODE=fake (spawned detached by FakeKubeGateway.ensureJob with the Job's env).
//
// State dir (argv[2]): log (stdout lines), pane (the tmux screen), input (keystrokes), kill (marker), exit (exit code),
// started (marker: the container runs). Protocol, mirroring the real runner (spec §8):
//   - log `agentdesk: checkout <sha>`, `plugins begin`, `plugins end`, the setup markers (`setup skipped (no script)`, or
//     `setup begin` + `setup passed` | `setup failed exit=1` when SETUP_SCRIPT contains `--fake-setup-fail`; the script is
//     never executed), then `agentdesk: session started`, write a banner and PROMPT to `pane`;
//   - a failed setup in a real run exits 78 before `session started`, like the runner;
//   - RUN_MODE=setup_test: session started after the setup markers (pass or fail), the pane is a shell that echoes typed
//     lines, and no turn markers are ever logged;
//   - after FAKE_TURN_MS (default 2000) log `agentdesk: turn finished`;
//   - each `\r`-terminated line appended to `input` is echoed to `pane`, logs `agentdesk: turn started` (the runner's
//     UserPromptSubmit hook; the first turn's start is implicit, the run is already running), then another turn finishes;
//   - on `kill`: log the scrollback (begin marker, pane lines, end marker), write `exit` 0 and exit.
//   - PROMPT containing `--fake-fail`: exit 3 after the first turn (with the scrollback);
//     `--fake-pending`: never start (the pod stays Pending) until killed.
// PROMPT is untrusted text: it is only written to files and searched with `includes`, never executed.
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const dir = process.argv[2];
if (!dir) process.exit(64);
const file = (n) => join(dir, n);
const prompt = process.env.PROMPT ?? '';
const setupScript = process.env.SETUP_SCRIPT ?? '';
const setupTest = process.env.RUN_MODE === 'setup_test';
const turnMs = Number.parseInt(process.env.FAKE_TURN_MS ?? '', 10) || 2000;
const maxLifeMs = Number.parseInt(process.env.FAKE_MAX_LIFE_MS ?? '', 10) || 60 * 60 * 1000;
const TICK_MS = 50;

const log = (line) => appendFileSync(file('log'), `${line}\n`);
const pane = (text) => appendFileSync(file('pane'), text);

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  log('agentdesk: final scrollback begin');
  const screen = existsSync(file('pane')) ? readFileSync(file('pane'), 'utf8') : '';
  for (const line of screen.split(/\r?\n/)) if (line.length > 0) log(line);
  log('agentdesk: final scrollback end');
  writeFileSync(file('exit'), String(code));
  process.exit(code);
}

const bornAt = Date.now();
const expired = () => Date.now() - bornAt > maxLifeMs;

if (prompt.includes('--fake-pending')) {
  // Never starts. Ends when killed (deleteJob kills the process group) or after the max lifetime.
  setInterval(() => {
    if (existsSync(file('kill')) || expired()) process.exit(0);
  }, TICK_MS);
} else {
  writeFileSync(file('started'), new Date().toISOString());
  log(`agentdesk: checkout ${'0'.repeat(40)}`);
  log('agentdesk: plugins begin');
  log('agentdesk: plugins end');
  let setupFailed = false;
  if (setupScript === '') {
    log('agentdesk: setup skipped (no script)');
  } else {
    log('agentdesk: setup begin');
    setupFailed = setupScript.includes('--fake-setup-fail');
    log(setupFailed ? 'agentdesk: setup failed exit=1' : 'agentdesk: setup passed');
  }
  if (setupFailed && !setupTest) {
    writeFileSync(file('exit'), '78');
    process.exit(78);
  }
  log('agentdesk: session started');
  if (setupTest) pane('$ ');
  else {
    pane('\u001b[1mFake Claude Code\u001b[0m (agentdesk fake pod)\r\n> ');
    pane(`${prompt.split(/\r?\n/).join('\r\n')}\r\n`);
  }

  const fail = prompt.includes('--fake-fail');
  // A line typed while a turn is in progress queues one more turn after it (like a prompt typed mid-turn).
  let turnTimer = null;
  let queued = 0;
  const scheduleTurn = (typed = false) => {
    if (turnTimer) {
      queued += 1;
      return;
    }
    if (typed) log('agentdesk: turn started');
    turnTimer = setTimeout(() => {
      turnTimer = null;
      log('agentdesk: turn finished');
      if (fail) return finish(3);
      if (queued > 0) {
        queued -= 1;
        scheduleTurn(true);
      }
    }, turnMs);
  };
  if (!setupTest) scheduleTurn();

  let inputOffset = 0;
  let pending = '';
  const decoder = new StringDecoder('utf8'); // a multi-byte character may straddle two reads
  setInterval(() => {
    if (existsSync(file('kill'))) return finish(0);
    if (expired()) return finish(0);
    if (!existsSync(file('input'))) return;
    const size = statSync(file('input')).size;
    if (size <= inputOffset) return;
    const buf = readFileSync(file('input')).subarray(inputOffset, size);
    inputOffset = size;
    pending += decoder.write(buf);
    let i;
    while ((i = pending.indexOf('\r')) >= 0) {
      const line = pending.slice(0, i).replace(/\n/g, '');
      pending = pending.slice(i + 1);
      pane(setupTest ? `${line}\r\n$ ` : `${line}\r\n`);
      if (!setupTest) scheduleTurn(true);
    }
  }, TICK_MS);
}
