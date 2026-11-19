// Fake run pod for KUBE_MODE=fake (spawned detached by FakeKubeGateway.ensureJob with the Job's env).
//
// State dir (argv[2]): log (stdout lines), pane (the tmux screen), input (keystrokes), stop and kill (markers), exit (exit code),
// started (marker: the container runs). Protocol, mirroring the real runner (spec §8):
//   - log `agentdesk: git identity <RUN_AUTHOR_NAME> <RUN_AUTHOR_EMAIL>` when the Job carries both (the real entrypoint
//     logs the identity it gives git, on a resume too; the fake pod runs no git, so this line is how a test sees the
//     trigger person reach the pod), then `agentdesk: checkout <sha>`, `plugins begin`, `plugins end`, the setup markers (`setup skipped (no script)`, or
//     `setup begin` + `setup passed` | `setup failed exit=1` when SETUP_SCRIPT contains `--fake-setup-fail`; the script is
//     never executed), then `agentdesk: session started`, write a banner and PROMPT to `pane`;
//   - a failed setup in a real run exits 78 before `session started`, like the runner;
//   - RUN_MODE=setup_test: session started after the setup markers (pass or fail), the pane is a shell that echoes typed
//     lines, and no turn markers are ever logged;
//   - a turn logs `agentdesk: state working` and, after FAKE_TURN_MS (default 2000), ends with
//     `agentdesk: state needs_input declared <b64>` (or `state done declared <b64>` when PROMPT contains `--fake-done`);
//     with `--fake-background` the turn first logs `state waiting background`, then after FAKE_TURN_MS a wake-up
//     `state working`, and after another FAKE_TURN_MS the normal end;
//   - each `\r`-terminated line appended to `input` is echoed to `pane` and queues another turn after the current one;
//   - FAKE_VOLUME_DIR is the run's volume (the gateway sets it from the Job's claim): a fresh start saves a
//     `session-started` marker there and mirrors the pane to `pane`; RUN_MODE=resume with no marker logs
//     `agentdesk: resume failed (no saved session)` and exits 79, otherwise logs `agentdesk: session resumed`, replays
//     the saved pane and waits for input (no checkout, plugins, setup or first turn), like the real runner;
//   - on `stop` (the worker's `agentdesk-end`): log the scrollback, then the runner's end line
//     `agentdesk: session ended reason=stop_request code=0`, write `exit` 0 and exit;
//   - on `kill` (the old `tmux kill-session` fallback): log the scrollback (begin marker, pane lines, end marker), write
//     `exit` 0 and exit, with no end line.
//   - PROMPT containing `--fake-fail`: exit 3 after the first turn (with the scrollback, then the runner's end line
//     `agentdesk: session ended reason=agent_exit code=3`, so the workflow sees a crashed agent, not a lost pod);
//     `--fake-pending`: never start (the pod stays Pending) until killed.
// The launch line is `agentdesk: agent claude model <AGENT_MODEL or default> endpoint <scheme://host[:port] of
// ANTHROPIC_BASE_URL or default>`, built by the same rules as the runner's. The fake pod prints it first (before the
// resume-failed exit 79 and the setup-failed exit 78, where the real runner prints none) so the e2e can read the first
// log line; the real runner prints it just before the tmux session starts. setup_test prints none, like the runner.
// PROMPT is untrusted text: it is only written to files and searched with `includes`, never executed.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const dir = process.argv[2];
if (!dir) process.exit(64);
const file = (n) => join(dir, n);
const prompt = process.env.PROMPT ?? '';
const setupScript = process.env.SETUP_SCRIPT ?? '';
const setupTest = process.env.RUN_MODE === 'setup_test';
const resume = process.env.RUN_MODE === 'resume';
const authorName = process.env.RUN_AUTHOR_NAME ?? '';
const authorEmail = process.env.RUN_AUTHOR_EMAIL ?? '';
const volumeDir = process.env.FAKE_VOLUME_DIR ?? '';
const volumeFile = (n) => join(volumeDir, n);
const turnMs = Number.parseInt(process.env.FAKE_TURN_MS ?? '', 10) || 2000;
const maxLifeMs = Number.parseInt(process.env.FAKE_MAX_LIFE_MS ?? '', 10) || 60 * 60 * 1000;
const TICK_MS = 50;

const log = (line) => appendFileSync(file('log'), `${line}\n`);
// Same rules as the launch line in images/runner/entrypoint.sh, so a line that passes here is one the runner prints:
// the model and the address keep only the characters of a model id / address (letters, digits and . _ : / @ [ ] + -),
// anything else becomes ?. The address is cut from the typed text (no URL parsing, so host case and a default port stay)
// to scheme://host[:port]; userinfo, an odd scheme or host, or no `://` print as default.
const LAUNCH_SAFE = /[^A-Za-z0-9._:/@+[\]-]/gu;
const launchEndpoint = (address) => {
  const sep = address.indexOf('://');
  if (sep < 0) return 'default';
  const scheme = address.slice(0, sep);
  const rest = address.slice(sep + 3).split(/[/?#]/u)[0];
  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/u.test(scheme)) return 'default';
  if (!/^([A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]+)?$/u.test(rest)) return 'default';
  return `${scheme}://${rest}`;
};
const launchLine = () => {
  const model = process.env.AGENT_MODEL || 'default';
  const endpoint = launchEndpoint(process.env.ANTHROPIC_BASE_URL ?? '');
  log(
    `agentdesk: agent claude model ${model.replace(LAUNCH_SAFE, '?')} endpoint ${endpoint.replace(LAUNCH_SAFE, '?')}`,
  );
};
const logIdentity = () => {
  if (authorName !== '' && authorEmail !== '') log(`agentdesk: git identity ${authorName} ${authorEmail}`);
};
const pane = (text) => {
  appendFileSync(file('pane'), text);
  if (volumeDir !== '' && !setupTest) appendFileSync(volumeFile('pane'), text);
};

let finished = false;
function finish(code, endReason) {
  if (finished) return;
  finished = true;
  log('agentdesk: final scrollback begin');
  const screen = existsSync(file('pane')) ? readFileSync(file('pane'), 'utf8') : '';
  for (const line of screen.split(/\r?\n/)) if (line.length > 0) log(line);
  log('agentdesk: final scrollback end');
  if (endReason) log(`agentdesk: session ended reason=${endReason} code=${code}`);
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
  if (!setupTest) launchLine();
  if (resume) {
    if (volumeDir === '' || !existsSync(volumeFile('session-started'))) {
      log('agentdesk: resume failed (no saved session)');
      writeFileSync(file('exit'), '79');
      process.exit(79);
    }
    logIdentity();
    log('agentdesk: session resumed');
    log('agentdesk: session started');
    // Replay the saved conversation into this pod's pane (not mirrored again: the volume already holds it).
    if (existsSync(volumeFile('pane'))) writeFileSync(file('pane'), readFileSync(volumeFile('pane')));
  } else {
    logIdentity();
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
    if (volumeDir !== '' && !setupTest) {
      mkdirSync(volumeDir, { recursive: true });
      writeFileSync(volumeFile('pane'), '');
      writeFileSync(volumeFile('session-started'), new Date().toISOString());
    }
    log('agentdesk: session started');
    if (setupTest) pane('$ ');
    else {
      pane('\u001b[1mFake Claude Code\u001b[0m (agentdesk fake pod)\r\n> ');
      pane(`${prompt.split(/\r?\n/).join('\r\n')}\r\n`);
    }
  }

  const fail = prompt.includes('--fake-fail');
  const done = prompt.includes('--fake-done');
  const background = prompt.includes('--fake-background');
  const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
  const endLine = done
    ? `agentdesk: state done declared ${b64('Fake agent finished')}`
    : `agentdesk: state needs_input declared ${b64('Fake agent is waiting')}`;
  // A line typed while a turn is in progress queues one more turn after it (like a prompt typed mid-turn).
  let turnTimer = null;
  let queued = 0;
  const endTurn = () => {
    turnTimer = null;
    log(endLine);
    if (fail) return finish(3, 'agent_exit');
    if (queued > 0) {
      queued -= 1;
      scheduleTurn();
    }
  };
  const scheduleTurn = () => {
    if (turnTimer) {
      queued += 1;
      return;
    }
    log('agentdesk: state working');
    if (background) {
      log('agentdesk: state waiting background');
      turnTimer = setTimeout(() => {
        log('agentdesk: state working');
        turnTimer = setTimeout(endTurn, turnMs);
      }, turnMs);
    } else turnTimer = setTimeout(endTurn, turnMs);
  };
  if (!setupTest && !resume) scheduleTurn();

  let inputOffset = 0;
  let pending = '';
  const decoder = new StringDecoder('utf8'); // a multi-byte character may straddle two reads
  setInterval(() => {
    if (existsSync(file('stop'))) return finish(0, 'stop_request');
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
      // A resumed pod runs no first turn, but a typed line starts one like in a fresh pod.
      if (!setupTest) scheduleTurn();
    }
  }, TICK_MS);
}
