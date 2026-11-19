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
//   - lifecycle controls (prompt flags plus files in the state dir): `--fake-hold-start` waits for a `release-start` file
//     before logging `session started`; `--fake-slow-end` makes `stop` wait for a `release-end` file; `--fake-hang-on-stop`
//     ignores `stop` (only `kill` ends the pod); `--fake-exit-ok` ends after the first turn with
//     `session ended reason=agent_exit code=0`; a `hardkill` file writes `exit` 137 and exits 137 at once, with no flush,
//     scrollback or end line.
//   - PROMPT containing `--fake-fail`: exit 3 after the first turn (with the scrollback, then the runner's end line
//     `agentdesk: session ended reason=agent_exit code=3`, so the workflow sees a crashed agent, not a lost pod);
//     `--fake-pending`: never start (the pod stays Pending) until killed.
//   - transcript (Part A): with FAKE_VOLUME_DIR set and the adapter file present (FAKE_TRANSCRIPT_ADAPTER, default the
//     real images/runner/agents/claude/transcript.mjs; empty or missing means an old image: nothing is written or sent),
//     the pod keeps a Claude-format session file under $FAKE_VOLUME_DIR/home/.claude/projects/<slug of
//     $FAKE_VOLUME_DIR/workspace>/<session>.jsonl: the prompt as a `user` entry at a fresh start, each typed line as a
//     `user` entry, and an `assistant` text "Fake agent reply <n>" at each turn end. It runs `<adapter> flush` (cwd the
//     workspace, HOME=$FAKE_VOLUME_DIR/home, AGENTDESK_STATE_DIR=$HOME/.agentdesk, AGENTDESK_STATUS_OUT=<state dir>/log)
//     after `session started`, when a typed line arrives, at each turn end and at the start of finish() before the
//     scrollback. Prompt flags: --fake-no-transcript (send nothing), --fake-thinking (first reply has a thinking block
//     "THINKING-MARKER"), --fake-tools (first turn adds Bash/Edit/Write/Read/two Grep tool steps, 200 and 201 chars of
//     input JSON, and a tool_result "OUTPUT-MARKER"), --fake-long-replies (first turn adds 8,000 and 8,001 byte
//     replies), --fake-api-error (first turn writes "API Error: 401 invalid credential" and ends like --fake-fail),
//     --fake-transcript-bulk=<n> (the first session file holds exactly n entries, sent by one flush at the first turn
//     end), --fake-unflushed (one more reply "UNFLUSHED-MARKER" is appended after the first turn's flush, unflushed),
//     --fake-bad-transcript-lines (after `session started`, three malformed transcript lines go to log and pane).
// PROMPT is untrusted text: it is only written to files and searched with `includes`, never executed.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { appendEntry, replyEntry, toolResultEntry, userEntry } from './fake-claude-log.mjs';

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
const adapterPath =
  process.env.FAKE_TRANSCRIPT_ADAPTER ??
  fileURLToPath(new URL('../../../../images/runner/agents/claude/transcript.mjs', import.meta.url));
const bulkMatch = /--fake-transcript-bulk=(\d+)/.exec(prompt);
const transcriptOn =
  volumeDir !== '' &&
  !setupTest &&
  adapterPath !== '' &&
  existsSync(adapterPath) &&
  !prompt.includes('--fake-no-transcript');

const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const log = (line) => appendFileSync(file('log'), `${line}\n`);
const logIdentity = () => {
  if (authorName !== '' && authorEmail !== '') log(`agentdesk: git identity ${authorName} ${authorEmail}`);
};
const pane = (text) => {
  appendFileSync(file('pane'), text);
  if (volumeDir !== '' && !setupTest) appendFileSync(volumeFile('pane'), text);
};

// Claude-shaped session log on the fake volume (nothing when the transcript is off, like an old image).
const workspaceDir = () => volumeFile('workspace');
let sessionPath = '';
let flushSuppressed = false;
function initSession() {
  if (!transcriptOn) return;
  mkdirSync(workspaceDir(), { recursive: true });
  const slug = realpathSync(workspaceDir()).replace(/[^A-Za-z0-9]/g, '-');
  const projectDir = join(volumeFile('home'), '.claude', 'projects', slug);
  mkdirSync(projectDir, { recursive: true });
  const idFile = volumeFile('claude-session-id');
  if (!existsSync(idFile)) writeFileSync(idFile, randomUUID());
  sessionPath = join(projectDir, `${readFileSync(idFile, 'utf8').trim()}.jsonl`);
}
const record = (entry) => {
  if (sessionPath !== '') appendEntry(sessionPath, entry);
};
function flushTranscript() {
  if (sessionPath === '' || flushSuppressed) return;
  const home = volumeFile('home');
  const stateDir = join(home, '.agentdesk');
  spawnSync(process.execPath, [adapterPath, 'flush'], {
    cwd: workspaceDir(),
    env: { ...process.env, HOME: home, AGENTDESK_STATE_DIR: stateDir, AGENTDESK_STATUS_OUT: file('log') },
    timeout: 5000,
    stdio: 'ignore',
  });
}
// Turns are counted on the volume so a resumed pod continues "Fake agent reply <n>".
function nextTurnNo() {
  if (volumeDir === '') return 1;
  const f = volumeFile('turns');
  const n = (existsSync(f) ? Number.parseInt(readFileSync(f, 'utf8'), 10) || 0 : 0) + 1;
  writeFileSync(f, String(n));
  return n;
}
function afterSessionStarted(fresh) {
  if (fresh && bulkMatch) {
    const total = Number.parseInt(bulkMatch[1], 10);
    for (let i = 1; i < total; i += 1) record(replyEntry(`bulk reply ${i}`));
    flushSuppressed = true;
  }
  flushTranscript();
  if (prompt.includes('--fake-bad-transcript-lines')) {
    for (const body of ['A'.repeat(12001), '!!!', b64('{"id":"a b","kind":"agent","text":"x"}')]) {
      log(`agentdesk: transcript ${body}`);
      pane(`agentdesk: transcript ${body}\r\n`);
    }
  }
}

let finished = false;
function finish(code, endReason) {
  if (finished) return;
  finished = true;
  flushSuppressed = false;
  flushTranscript();
  log('agentdesk: final scrollback begin');
  const screen = existsSync(file('pane')) ? readFileSync(file('pane'), 'utf8') : '';
  for (const line of screen.split(/\r?\n/)) if (line.length > 0) log(line);
  log('agentdesk: final scrollback end');
  if (endReason) log(`agentdesk: session ended reason=${endReason} code=${code}`);
  writeFileSync(file('exit'), String(code));
  process.exit(code);
}

// A pod killed from outside (OOM, node loss): no flush, no scrollback and no end line.
function hardKill() {
  writeFileSync(file('exit'), '137');
  process.exit(137);
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
  let startFresh = null; // the fresh start's tail, from the volume marker to the pane banner
  if (resume) {
    if (volumeDir === '' || !existsSync(volumeFile('session-started'))) {
      log('agentdesk: resume failed (no saved session)');
      writeFileSync(file('exit'), '79');
      process.exit(79);
    }
    logIdentity();
    initSession();
    log('agentdesk: session resumed');
    log('agentdesk: session started');
    afterSessionStarted(false);
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
    startFresh = () => {
      if (volumeDir !== '' && !setupTest) {
        mkdirSync(volumeDir, { recursive: true });
        writeFileSync(volumeFile('pane'), '');
        writeFileSync(volumeFile('session-started'), new Date().toISOString());
      }
      initSession();
      if (!setupTest) record(userEntry(prompt));
      log('agentdesk: session started');
      afterSessionStarted(true);
      if (setupTest) pane('$ ');
      else {
        pane('\u001b[1mFake Claude Code\u001b[0m (agentdesk fake pod)\r\n> ');
        pane(`${prompt.split(/\r?\n/).join('\r\n')}\r\n`);
      }
    };
  }

  function runTurns() {
    const apiError = !resume && prompt.includes('--fake-api-error');
    const fail = prompt.includes('--fake-fail') || apiError;
    const exitOk = !resume && prompt.includes('--fake-exit-ok');
    const hangOnStop = prompt.includes('--fake-hang-on-stop');
    const slowEnd = prompt.includes('--fake-slow-end');
    const done = prompt.includes('--fake-done');
    const background = prompt.includes('--fake-background');
    const endLine = done
      ? `agentdesk: state done declared ${b64('Fake agent finished')}`
      : `agentdesk: state needs_input declared ${b64('Fake agent is waiting')}`;
    // A line typed while a turn is in progress queues one more turn after it (like a prompt typed mid-turn).
    const recordTurnEnd = (n) => {
      if (sessionPath === '') return;
      const first = n === 1 && !resume;
      if (first && bulkMatch) {
        flushSuppressed = false;
        flushTranscript();
        return;
      }
      const tools = [];
      if (first && prompt.includes('--fake-tools')) {
        tools.push(
          { name: 'Bash', input: { command: 'dotnet test' } },
          { name: 'Edit', input: { file_path: 'src/Edit.cs' } },
          { name: 'Write', input: { file_path: 'src/Write.cs' } },
          { name: 'Read', input: { file_path: 'src/Read.cs' } },
          // JSON.stringify adds 14 chars around the pattern: these inputs are exactly 200 and 201 chars.
          { name: 'Grep', input: { pattern: 'x'.repeat(186) } },
          { name: 'Grep', input: { pattern: 'y'.repeat(187) } },
        );
      }
      if (first && apiError) record(replyEntry('API Error: 401 invalid credential', { apiError: true }));
      else {
        record(
          replyEntry(`Fake agent reply ${n}`, {
            thinking: first && prompt.includes('--fake-thinking') ? 'THINKING-MARKER' : undefined,
            tools,
          }),
        );
      }
      if (tools.length > 0) record(toolResultEntry('OUTPUT-MARKER'));
      if (first && prompt.includes('--fake-long-replies')) {
        record(replyEntry('a'.repeat(8000)));
        record(replyEntry('b'.repeat(8001)));
      }
      flushTranscript();
      if (first && prompt.includes('--fake-unflushed')) record(replyEntry('UNFLUSHED-MARKER'));
    };
    let turnTimer = null;
    let queued = 0;
    const endTurn = () => {
      turnTimer = null;
      recordTurnEnd(nextTurnNo());
      log(endLine);
      if (fail) return finish(3, 'agent_exit');
      if (exitOk) return finish(0, 'agent_exit');
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
      if (existsSync(file('hardkill'))) hardKill();
      if (existsSync(file('stop')) && !hangOnStop && (!slowEnd || existsSync(file('release-end')))) {
        return finish(0, 'stop_request');
      }
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
        if (!setupTest) {
          record(userEntry(line));
          flushTranscript();
          scheduleTurn();
        }
      }
    }, TICK_MS);
  }

  if (!resume && prompt.includes('--fake-hold-start')) {
    // Held after the setup markers until the test releases it (a pod that is Running but has not started the agent).
    const hold = setInterval(() => {
      if (existsSync(file('hardkill'))) hardKill();
      if (existsSync(file('kill')) || expired()) process.exit(0);
      if (!existsSync(file('release-start'))) return;
      clearInterval(hold);
      startFresh?.();
      runTurns();
    }, TICK_MS);
  } else {
    startFresh?.();
    runTurns();
  }
}
