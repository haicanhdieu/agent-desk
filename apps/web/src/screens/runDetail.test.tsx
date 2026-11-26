import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type OrgSwitchProps } from '@/components';
import { orgSwitchFixtures } from '@/mocks';
import { runDetailPrMerged, runDetails, runUsageDetails, terminalByRun, transcriptFixtures } from '@/mocks';
import type { RunDetailKey } from '@/mocks';
import { RunDetail as RunDetailScreen } from './RunDetail';

// The screen shows a run action only for a handler it is given (the route passes one where the viewer holds the
// permission). These tests exercise the buttons themselves, so they render a viewer who may do everything; the
// "without a handler" cases below use the bare screen.
const noop = () => undefined;
const RunDetail = (props: React.ComponentProps<typeof RunDetailScreen>) => (
  <RunDetailScreen
    onCancel={noop}
    onFinish={noop}
    onResume={noop}
    onStopOpen={noop}
    onStop={noop}
    onCloseSession={noop}
    {...props}
  />
);

const linesFor = (k: RunDetailKey) => terminalByRun[runDetails[k].run.id];
const show = (k: RunDetailKey, extra: Partial<React.ComponentProps<typeof RunDetail>> = {}) =>
  render(<RunDetail data={runDetails[k]} lines={linesFor(k)} {...extra} />);

const ended: RunDetailKey[] = ['RunSucceeded', 'RunFailed', 'RunTimedOut', 'RunCancelled', 'RunExpired'];
const FINISH_TITLE = 'Finish is available when the agent is waiting for you';

describe('RunDetail top bar', () => {
  it('the bar reads Runs / Run 62 and the title never holds the ticket title', () => {
    const data = runDetails.RunSucceeded;
    render(
      <RunDetailScreen
        data={{
          ...data,
          run: { ...data.run, id: 62 },
          pullRequest: data.pullRequest && {
            ...data.pullRequest,
            ticket: { ...data.pullRequest.ticket, title: '<b>Export</b> invoices as CSV' },
          },
        }}
      />,
    );
    const bar = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(bar.getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/runs');
    expect(bar.getByText('Run 62')).toHaveAttribute('aria-current', 'page');
    expect(document.title).toBe('Run 62 · invoicer-api · Agent Desk');
    expect(document.title).not.toContain('Export');
  });
});

describe('RunDetail without action handlers (a viewer, or a member on another person run)', () => {
  const bare = (k: RunDetailKey) => render(<RunDetailScreen data={runDetails[k]} lines={linesFor(k)} />);

  it('an idle run shows no Finish, Stop session or Cancel run, in the top bar or the notice', () => {
    bare('RunIdle');
    expect(screen.queryByRole('button', { name: /^Finish/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
    expect(screen.getByText('The agent is waiting for your answer')).toBeInTheDocument();
  });

  it('a running run shows no Cancel run or Stop session', () => {
    bare('RunRunning');
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop session' })).not.toBeInTheDocument();
  });

  it('a done run shows no Finish run', () => {
    bare('RunDone');
    expect(screen.queryByRole('button', { name: /^Finish/ })).not.toBeInTheDocument();
  });

  it('a paused run shows no Resume and no Finish', () => {
    bare('RunPaused');
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Finish/ })).not.toBeInTheDocument();
  });

  it('a succeeded run with a kept session shows no Reopen session', () => {
    render(<RunDetailScreen data={runDetails.RunSucceeded} />);
    expect(screen.queryByRole('button', { name: 'Reopen session' })).not.toBeInTheDocument();
  });

  it('a reopened session shows no Close session', () => {
    render(<RunDetailScreen data={{ ...runDetails.RunSucceeded, reopened: true }} />);
    expect(screen.queryByRole('button', { name: 'Close session' })).not.toBeInTheDocument();
  });
});

describe('RunDetail actions', () => {
  it.each(['RunStarting', 'RunRunning', 'RunReconnect'] as RunDetailKey[])(
    '%s: Finish is disabled with the explanatory title',
    (k) => {
      show(k);
      const finish = screen.getByRole('button', { name: 'Finish' });
      expect(finish).toBeDisabled();
      expect(finish).toHaveAttribute('title', FINISH_TITLE);
      expect(screen.getByRole('button', { name: 'Cancel run' })).toBeEnabled();
    },
  );

  it('idle: Finish run is enabled (top bar and notice strip) and has no explanatory title', () => {
    show('RunIdle');
    const buttons = screen.getAllByRole('button', { name: 'Finish run' });
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b).toBeEnabled();
      expect(b).not.toHaveAttribute('title', FINISH_TITLE);
    }
    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  });

  it.each(ended)('%s: no Cancel run or Finish, the ticket link points at the ticket', (k) => {
    show(k);
    const label = runDetails[k].run.ticket.kind === 'pr' ? 'View PR' : 'View issue';
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Finish/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', runDetails[k].run.ticket.href);
  });

  it.each([
    ['pr', 'View PR'],
    ['issue', 'View issue'],
  ] as const)('labels the link of a %s ticket "%s", never "View ticket"', (kind, label) => {
    const base = runDetails.RunSucceeded;
    render(
      <RunDetail
        data={{ ...base, run: { ...base.run, ticket: { ...base.run.ticket, kind } } }}
        lines={linesFor('RunSucceeded')}
      />,
    );
    expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View ticket' })).not.toBeInTheDocument();
  });

  it.each(ended)('%s: the ticket link opens in a new tab without giving the page access to the opener', (k) => {
    show(k);
    const link = screen.getByRole('link', { name: /^View (PR|issue)$/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it.each(Object.keys(runDetails) as RunDetailKey[])('%s: never says Retry about the run and has one main', (k) => {
    show(k);
    expect(screen.queryByText(/^retry$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('top bar: breadcrumb, command on ticket, elapsed and the panel buttons', () => {
    show('RunRunning');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Run 61');
    expect(within(screen.getByRole('banner')).getByText('/code-build')).toBeInTheDocument();
    expect(screen.getAllByText('Issue #139').length).toBeGreaterThan(0);
    expect(screen.getAllByText('7:40').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Collapse context panel (])' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Full screen terminal (F)' })).toBeInTheDocument();
  });
});

describe('RunDetail done and agent notes', () => {
  it('done: Finish run is enabled in the top bar and the banner', () => {
    show('RunDone');
    const buttons = screen.getAllByRole('button', { name: 'Finish run' });
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  });

  it('done: banner title and body, with no agent note', () => {
    show('RunDone');
    expect(screen.getByText('The agent says the task is done')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Review the work, type in the terminal to ask for changes, or Finish to end the run as succeeded.',
      ),
    ).toBeInTheDocument();
  });

  it('done: the agent note shows above the body as plain text, never markup', () => {
    const data = { ...runDetails.RunDone, agentNote: '<b>x</b> opened PR #9' };
    const { container } = render(<RunDetail data={data} lines={linesFor('RunDone')} />);
    expect(screen.getByText('<b>x</b> opened PR #9')).toBeInTheDocument();
    expect([...container.querySelectorAll('b')].some((b) => b.textContent === 'x')).toBe(false);
  });

  it('done: Finish is held while a finish is in flight', () => {
    show('RunDone', { pendingNote: 'Finishing…' });
    for (const b of screen.getAllByRole('button', { name: 'Finish run' })) expect(b).toBeDisabled();
  });

  it('needs you: the agent note shows above the existing body', () => {
    const data = { ...runDetails.RunIdle, agentNote: 'Which database should I use?' };
    render(<RunDetail data={data} lines={linesFor('RunIdle')} />);
    expect(screen.getByText('The agent is waiting for your answer')).toBeInTheDocument();
    expect(screen.getByText('Which database should I use?')).toBeInTheDocument();
    expect(screen.getByText(/Type your answer in the terminal below/)).toBeInTheDocument();
  });
});

describe('RunDetail paused, kept and expired sessions', () => {
  const kept = {
    ...runDetails.RunSucceeded,
    agentNote: 'Opened PR #148.',
    session: { state: 'kept', detail: 'Session kept until 13 Nov, 09:05' },
  } as const;

  it('paused: the lines around the agent note, then Resume and Finish; no Cancel, no disabled Finish', () => {
    show('RunPaused');
    const text = screen.getByText(/^Paused: waiting for your answer\. Can be resumed for/);
    const note = screen.getByText(runDetails.RunPaused.agentNote ?? 'missing note');
    const since = screen.getByText(/^Paused .*, after 30 min with nobody attached$/);
    expect(text.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(since) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^View (PR|issue)$/ })).toBeInTheDocument();
  });

  it('paused: the buttons call back', async () => {
    const onResume = vi.fn();
    const onFinish = vi.fn();
    show('RunPaused', { onResume, onFinish });
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('paused: both buttons wait while a resume is in flight', () => {
    show('RunPaused', { resuming: true });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled();
  });

  it('paused: both buttons wait while a finish is in flight', () => {
    show('RunPaused', { pendingNote: 'Finishing…' });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled();
  });

  it('paused: a resume failure is an error banner above the buttons', () => {
    const data = {
      ...runDetails.RunPaused,
      session: { state: 'paused', resumeFailure: 'Resume failed: no pod' },
    } as const;
    render(<RunDetail data={data} />);
    const failure = screen.getByText('Resume failed: no pod');
    expect(failure.compareDocumentPosition(screen.getByRole('button', { name: 'Resume' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('succeeded with a kept session: the note, the kept-until line and Reopen session', async () => {
    const onResume = vi.fn();
    render(<RunDetail data={kept} lines={linesFor('RunSucceeded')} onResume={onResume} />);
    expect(screen.getByText('Opened PR #148.')).toBeInTheDocument();
    expect(screen.getByText('Session kept until 13 Nov, 09:05')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reopen session' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Finish/ })).not.toBeInTheDocument();
  });

  it('succeeded without a kept session: Reopen session is disabled and says the disk is gone', () => {
    show('RunSucceeded');
    const reopen = screen.getByRole('button', { name: 'Reopen session' });
    expect(reopen).toBeDisabled();
    expect(reopen).toHaveAttribute('title', expect.stringContaining('Reopen unavailable'));
  });

  describe('a reopened session of a succeeded run', () => {
    const reopened = { ...runDetails.RunDone, reopened: true } as const;

    it('shows the Succeeded · Session open pill and Close session as the only action', async () => {
      const onCloseSession = vi.fn();
      render(<RunDetail data={reopened} onCloseSession={onCloseSession} />);
      expect(screen.getByText('Succeeded · Session open')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Close session' }));
      expect(onCloseSession).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: /^(Finish|Stop session|Cancel run)/ })).not.toBeInTheDocument();
    });

    it('replaces the stale "task is done" banner, which had a Finish run button', () => {
      render(<RunDetail data={reopened} />);
      expect(screen.queryByText('The agent says the task is done')).not.toBeInTheDocument();
      expect(screen.getByText('Session open: this run already succeeded')).toBeInTheDocument();
    });

    it('also replaces the waiting-for-your-answer banner while the agent asks a question', () => {
      render(<RunDetail data={{ ...runDetails.RunIdle, reopened: true }} />);
      expect(screen.queryByText('The agent is waiting for your answer')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Finish/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close session' })).toBeInTheDocument();
    });

    it('Close session waits while a close is in flight and while the session is ending', () => {
      const { rerender } = render(<RunDetail data={reopened} closing />);
      expect(screen.getByRole('button', { name: 'Close session' })).toBeDisabled();
      rerender(<RunDetail data={{ ...reopened, pausing: true }} />);
      expect(screen.getByRole('button', { name: 'Close session' })).toBeDisabled();
    });

    it('Close session waits while the reopen is still starting', () => {
      render(<RunDetail data={{ ...runDetails.RunStarting, reopened: true }} />);
      expect(screen.getByRole('button', { name: 'Close session' })).toBeDisabled();
    });
  });

  it('expired: the expired line and no action buttons', () => {
    show('RunExpired');
    expect(
      screen.getByText('Nobody resumed this run within 7 days. The saved session was deleted.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Resume|Finish|Cancel|Reopen)/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^View (PR|issue)$/ })).toBeInTheDocument();
  });
});

describe('RunDetail top bar elapsed', () => {
  it.each([
    ['RunStarting', '0:24'],
    ['RunRunning', '7:40'],
    ['RunIdle', '4:51'],
    ['RunReconnect', '9:02'],
    ['RunSucceeded', '6m 12s'],
    ['RunFailed', '1m 10s'],
    ['RunTimedOut', '30m'],
    ['RunCancelled', '7m 50s'],
  ] as [RunDetailKey, string][])('%s shows %s', (k, text) => {
    show(k);
    expect(within(screen.getByRole('banner')).getByText(text)).toBeInTheDocument();
  });
});

describe('RunDetail cancel confirmation', () => {
  it('is absent by default', () => {
    show('RunRunning');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a dialog named Cancel run 61? with Keep running and Cancel run; Escape closes', async () => {
    const onCancelClose = vi.fn();
    show('RunRunning', { cancelConfirmOpen: true, onCancelClose });
    const dialog = screen.getByRole('dialog', { name: 'Cancel run 61?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Keep running' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onCancelClose).toHaveBeenCalled();
  });

  it('Keep running calls the close handler', async () => {
    const onCancelClose = vi.fn();
    show('RunRunning', { cancelConfirmOpen: true, onCancelClose });
    await userEvent.click(screen.getByRole('button', { name: 'Keep running' }));
    expect(onCancelClose).toHaveBeenCalledTimes(1);
  });
});

describe('RunDetail reconnecting and collapsed panel', () => {
  it('shows Reconnecting, attempt 3 and a status region with Reconnect now', () => {
    show('RunReconnect', { panelCollapsed: true });
    expect(screen.getByText('Reconnecting, attempt 3')).toBeInTheDocument();
    const region = screen.getByRole('status', { name: 'Connection to the terminal lost' });
    expect(within(region).getByRole('button', { name: 'Reconnect now' })).toBeInTheDocument();
  });

  it('collapsed: Expand button instead of the context sections', () => {
    show('RunReconnect', { panelCollapsed: true });
    expect(screen.getByRole('button', { name: 'Expand context panel (])' })).toBeInTheDocument();
    const rail = screen.getByRole('complementary', { name: 'Run context, collapsed' });
    for (const name of ['Issue #139', 'Running', 'Chain: 1 of 2'])
      expect(within(rail).getByRole('img', { name })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Run context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ticket' })).not.toBeInTheDocument();
    expect(screen.queryByText('Chain on this ticket')).not.toBeInTheDocument();
  });

  it('expanded: the context panel and its sections are there', () => {
    show('RunRunning');
    expect(screen.getByRole('complementary', { name: 'Run context' })).toBeInTheDocument();
    expect(screen.getByText('Chain on this ticket')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Connection to the terminal lost' })).not.toBeInTheDocument();
  });
});

describe('RunDetail per state', () => {
  it('starting: placeholder, checklist and no terminal yet', () => {
    show('RunStarting');
    expect(screen.getByRole('heading', { name: 'Starting the agent' })).toBeInTheDocument();
    expect(screen.getByText('No terminal yet')).toBeInTheDocument();
    expect(screen.getByText('Cloning harbor-labs/invoicer-api at main')).toBeInTheDocument();
    expect(screen.getByText(/If the pod is still pending after 2 minutes/)).toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(screen.queryByText('Pull request')).not.toBeInTheDocument();
    expect(screen.queryByText(/None yet\. A link appears here/)).not.toBeInTheDocument();
  });

  it('running: live terminal, time meter, lifecycle, and no Pull request section', () => {
    show('RunRunning');
    expect(screen.queryByText('Pull request')).not.toBeInTheDocument();
    expect(screen.queryByText(/None yet\. A link appears here/)).not.toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Claude Code terminal' })).toBeInTheDocument();
    expect(screen.getByText('Live, attached as kim-hale')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '26% of run time limit used' })).toBeInTheDocument();
    expect(screen.getByText('Lifecycle')).toBeInTheDocument();
    expect(screen.getByText('Claude Code started')).toBeInTheDocument();
  });

  it('idle: amber notice, cursor, Waiting for you with the amber timer note', () => {
    const { container } = show('RunIdle');
    expect(screen.getByText('The agent is waiting for your answer')).toBeInTheDocument();
    expect(container.querySelector('[class*="cursor"]')).not.toBeNull();
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
    expect(screen.getByText('Timer paused')).toBeInTheDocument();
    expect(screen.getByText('14:13:58')).toBeInTheDocument();
    expect(screen.getByText('14:44')).toBeInTheDocument();
    expect(screen.getByText(/ends as succeeded after 30 minutes/)).toBeInTheDocument();
    expect(screen.getByText('It holds 1 of 2 slots. Run 63 is queued behind it.')).toBeInTheDocument();
  });

  it('succeeded: ok banner with Go to run 62, Final scrollback, pull request with diffstat', () => {
    const { container } = show('RunSucceeded');
    expect(screen.getByText('Succeeded in 6m 12s.').closest('[class*="banner"]')).toHaveClass('ok', 'flush');
    expect(screen.getByRole('link', { name: 'Go to run 62' })).toHaveAttribute('href', '/runs/62');
    expect(screen.getByRole('tab', { name: /Final scrollback/ })).toBeInTheDocument();
    expect(screen.queryByText('coming in MVP')).not.toBeInTheDocument();
    expect(screen.getByText('+214 −12')).toBeInTheDocument();
    expect(container.querySelector('[class*="cursor"]')).toBeNull();
  });

  it('succeeded with a linked PR: the Pull request section shows its title and link', () => {
    show('RunSucceeded');
    const section = screen.getByText('Pull request').closest('section') ?? document.body;
    expect(within(section).getByText(/Export invoices as CSV/)).toBeInTheDocument();
  });

  it('succeeded without a linked PR: no Pull request section and no empty note', () => {
    const noPr = { ...runDetails.RunSucceeded };
    delete noPr.pullRequest;
    render(<RunDetail data={noPr} lines={linesFor('RunSucceeded')} />);
    expect(screen.queryByText('Pull request')).not.toBeInTheDocument();
    expect(screen.queryByText(/None yet/)).not.toBeInTheDocument();
  });

  it('failed: err banner with actions and no Retry, top-anchored terminal', () => {
    show('RunFailed');
    const banner = screen.getByText(/Failed after 1m 10s/).closest('[class*="banner"]')!;
    expect(banner).toHaveClass('err', 'flush', 'prominent');
    expect(within(banner as HTMLElement).getByRole('link', { name: 'Replace credential' })).toBeInTheDocument();
    expect(within(banner as HTMLElement).getByRole('button', { name: 'Copy /code-review' })).toBeInTheDocument();
    expect(within(banner as HTMLElement).getByRole('link', { name: 'Open PR #133' })).toBeInTheDocument();
    expect(screen.getByRole('log').className).toMatch(/top/);
  });

  it('timed out: late banner, Change time limit, meter at 100% in the late tone', () => {
    show('RunTimedOut');
    const banner = screen.getByText('Timed out at the 30 min limit').closest('[class*="banner"]')!;
    expect(banner).toHaveClass('late', 'flush', 'prominent');
    expect(within(banner as HTMLElement).getByRole('link', { name: 'Change time limit' })).toBeInTheDocument();
    expect(within(banner as HTMLElement).getByRole('button', { name: 'Copy /code-e2e' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '100% of run time limit used' }).className).toMatch(/late/);
  });

  it('cancelled: off banner, no scrollback saved, event log, branch link', () => {
    show('RunCancelled');
    expect(screen.getByText('Cancelled by kim-hale at 13:10:41.').closest('[class*="banner"]')).toHaveClass(
      'off',
      'flush',
    );
    expect(screen.getByRole('heading', { name: 'No scrollback was saved' })).toBeInTheDocument();
    expect(screen.getByText('Pod removed, run cancelled')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Branch ad/120-dark-mode on GitHub' })).toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
  });

  it('ended runs show the Ended line and an Ended row; no credential value anywhere', () => {
    const { container } = show('RunSucceeded');
    expect(screen.getByText('Ended, read-only, 1,208 lines')).toBeInTheDocument();
    expect(screen.getByText('Ended')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/sk-ant|ghp_|oauth-token|Bearer /i);
  });
});

describe('RunDetail app props', () => {
  it('pendingNote shows in the top bar and holds Finish and Cancel', () => {
    show('RunIdle', { pendingNote: 'Finishing…' });
    expect(within(screen.getByRole('banner')).getByRole('status')).toHaveTextContent('Finishing…');
    for (const b of screen.getAllByRole('button', { name: 'Finish run' })) expect(b).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeDisabled();
  });

  it('terminal replaces the static terminal', () => {
    show('RunRunning', { terminal: <div data-testid="live" /> });
    expect(screen.getByTestId('live')).toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
  });

  it('links set the logo, Runs crumb and Desk hrefs; cancelBody replaces the confirmation text', () => {
    show('RunRunning', {
      links: {
        projects: '/o/a/projects',
        runs: '/o/a/p/1/runs',
        skills: '/o/a/p/1/desk/skills',
        rules: '/o/a/p/1/desk/rules',
      },
      cancelConfirmOpen: true,
      cancelBody: 'Stops the pod.',
    });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(screen.getByRole('link', { name: 'Agent Desk, all projects' })).toHaveAttribute('href', '/o/a/projects');
    expect(within(crumbs).getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/o/a/p/1/runs');
    expect(screen.getByRole('link', { name: 'code-build' })).toHaveAttribute('href', '/o/a/p/1/desk/skills');
    expect(screen.getByRole('dialog')).toHaveTextContent('Stops the pod.');
  });
});

describe('RunDetail pausing, resumed and pause reasons', () => {
  const idle = runDetails.RunIdle;

  it('pausing: says so, closes the terminal view, and the idle notice is gone', () => {
    const data = { ...idle, pausing: true, connection: { state: 'none', label: 'Ending…' } } as const;
    render(<RunDetail data={data} />);
    expect(screen.getByText('Session ending…')).toBeInTheDocument();
    expect(
      screen.getByText('The session is being saved. This page updates by itself when the session has ended.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pausing/)).not.toBeInTheDocument();
    expect(screen.getByText('Ending…')).toBeInTheDocument();
    expect(screen.queryByText('The agent is waiting for your answer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it('pausing: the last scrollback shows greyed', () => {
    const data = { ...idle, pausing: true, connection: { state: 'none', label: 'Ending…' } } as const;
    render(<RunDetail data={data} lines={[[{ text: 'last words' }]]} />);
    const log = screen.getByRole('log');
    expect(log).toHaveTextContent('last words');
    expect(log.className).toMatch(/dimmed/);
  });

  it('resumed: the banner sits above the idle notice, the note stays text', () => {
    const text =
      'Resumed. The agent asked: <b>x</b>. Background tasks and sub-agents that were running when it paused were stopped.';
    render(<RunDetail data={{ ...idle, resumed: text }} lines={linesFor('RunIdle')} />);
    const banner = screen.getByText(text);
    expect(banner.compareDocumentPosition(screen.getByText('The agent is waiting for your answer'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(banner.querySelector('b')).toBeNull();
  });

  it('closed for inactivity: a status region with the text and a Reconnect button, no "connection lost" overlay', async () => {
    const onReconnect = vi.fn();
    const body = 'Nobody used this page for <b>4 hours</b>, so the terminal was closed.';
    render(<RunDetail data={idle} lines={linesFor('RunIdle')} inactiveBody={body} onReconnect={onReconnect} />);
    const region = screen.getByRole('status', { name: 'Terminal closed for inactivity' });
    expect(within(region).getByText(body)).toBeInTheDocument();
    expect(region.querySelector('b')).toBeNull();
    expect(screen.queryByText('Connection to the terminal lost')).not.toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Reconnect' }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('not inactive: no inactivity overlay', () => {
    show('RunIdle');
    expect(screen.queryByText('Terminal closed for inactivity')).not.toBeInTheDocument();
  });

  it('no resumed text: no resumed banner', () => {
    show('RunIdle');
    expect(screen.queryByText(/^Resumed\./)).not.toBeInTheDocument();
  });

  it('resuming: a queued run says it is resuming, not starting the agent', () => {
    render(<RunDetail data={{ ...runDetails.RunStarting, resuming: true }} />);
    expect(screen.getByText('Resuming the run')).toBeInTheDocument();
    expect(screen.queryByText('Starting the agent')).not.toBeInTheDocument();
    show('RunStarting');
    expect(screen.getByText('Starting the agent')).toBeInTheDocument();
  });

  it('a succeeded run with a failed queued resume shows the message and a disabled Reopen session', () => {
    const data = {
      ...runDetails.RunSucceeded,
      session: { state: 'none', resumeFailure: 'Resume failed: nothing was kept to resume from' },
    } as const;
    render(<RunDetail data={data} lines={linesFor('RunSucceeded')} />);
    expect(screen.getByText('Resume failed: nothing was kept to resume from')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen session' })).toBeDisabled();
  });

  it('paused by a crashed agent: the headline with the exit code, and Resume and Finish', () => {
    const data = {
      ...runDetails.RunPaused,
      session: {
        state: 'paused',
        headline: 'Paused: agent crashed (exit code 2)',
        detail: 'Paused 2 min ago, the agent crashed. Can be resumed for 5 days.',
      },
    } as const;
    render(<RunDetail data={data} onResume={() => {}} />);
    expect(screen.getByText('Paused: agent crashed (exit code 2)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
  });
});

describe('RunDetail transcript and stopped', () => {
  const ready = { state: 'ready', items: transcriptFixtures.default, hasEarlier: true } as const;

  it('a live run shows only the Terminal tab and no Transcript tab', () => {
    show('RunRunning');
    expect(screen.getByRole('tab', { name: 'Terminal' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.queryByText('coming in MVP')).not.toBeInTheDocument();
  });

  it('a stopped run shows the Stopped notice headline and detail, Resume and Finish, and the Transcript under a bar without Find or Copy all', () => {
    render(<RunDetail data={runDetails.RunStopped} transcript={ready} onResume={() => {}} />);
    expect(screen.getByText('Stopped: can be resumed for 7 days.')).toBeInTheDocument();
    expect(screen.getByText('Stopped by you 2 min ago.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Paused, read-only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Find/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy all' })).not.toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Transcript of the agent conversation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show earlier messages' })).toBeInTheDocument();
  });

  it("the paused notice's icon reads Stopped only for a stopped run", () => {
    const { unmount } = render(<RunDetail data={runDetails.RunStopped} transcript={ready} />);
    expect(screen.getByRole('img', { name: 'Stopped' })).toBeInTheDocument();
    unmount();
    render(<RunDetail data={runDetails.RunPaused} transcript={ready} />);
    expect(screen.getAllByRole('img', { name: 'Paused' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('img', { name: 'Stopped' })).not.toBeInTheDocument();
  });

  it('a session ending shows Session ending… above a loading Transcript', () => {
    const data = { ...runDetails.RunIdle, pausing: true, connection: { state: 'none', label: 'Ending…' } } as const;
    render(<RunDetail data={data} transcript={{ state: 'loading', items: [] }} />);
    const notice = screen.getByText('Session ending…');
    const loading = screen.getByRole('status', { name: 'Loading the transcript' });
    expect(notice.compareDocumentPosition(loading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole('tab', { name: 'Transcript' })).toBeInTheDocument();
    expect(screen.getByText('Ending…')).toBeInTheDocument();
  });

  it('a cancelled run with a transcript shows the Transcript, not No scrollback was saved', () => {
    render(<RunDetail data={runDetails.RunCancelled} transcript={ready} />);
    expect(screen.getByRole('log', { name: 'Transcript of the agent conversation' })).toBeInTheDocument();
    expect(screen.getByText(/Cancelled by kim-hale/)).toBeInTheDocument();
    expect(screen.queryByText('No scrollback was saved')).not.toBeInTheDocument();
  });

  it('an expired run with a transcript keeps the Transcript under the Expired notice', () => {
    render(<RunDetail data={runDetails.RunExpired} transcript={ready} />);
    expect(screen.getByText(/Nobody resumed this run within 7 days/)).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  it('a succeeded run after Finish shows Finished. The session was deleted and cannot be resumed. and a disabled Reopen session', () => {
    render(<RunDetail data={runDetails.RunSucceededFinished} transcript={ready} />);
    expect(screen.getByText('Succeeded in 9m 03s.')).toBeInTheDocument();
    expect(screen.getByText('Finished. The session was deleted and cannot be resumed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen session' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Transcript (read-only)' })).toBeInTheDocument();
    expect(screen.getByText('Ended, read-only')).toBeInTheDocument();
  });

  it("without a transcript prop a paused run keeps today's Saved scrollback tab", () => {
    show('RunPaused');
    expect(screen.getByRole('tab', { name: 'Saved scrollback' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.queryByText('coming in MVP')).not.toBeInTheDocument();
    expect(screen.queryByRole('log', { name: 'Transcript of the agent conversation' })).not.toBeInTheDocument();
  });

  it('starting and resuming keep their placeholder even with a transcript prop', () => {
    const { unmount } = render(<RunDetail data={runDetails.RunStarting} transcript={ready} />);
    expect(screen.getByText('Starting the agent')).toBeInTheDocument();
    expect(screen.queryByRole('log', { name: 'Transcript of the agent conversation' })).not.toBeInTheDocument();
    unmount();
    render(<RunDetail data={{ ...runDetails.RunStarting, resuming: true }} transcript={ready} />);
    expect(screen.getByText('Resuming the run')).toBeInTheDocument();
    expect(screen.queryByRole('log', { name: 'Transcript of the agent conversation' })).not.toBeInTheDocument();
  });
});

describe('RunDetail Stop session', () => {
  const STOP_TITLE = 'The session is already ending';
  const topBarNames = () =>
    within(screen.getByRole('banner'))
      .getAllByRole('button')
      .map((b) => b.textContent);

  it.each([
    ['RunRunning', 'Finish'],
    ['RunIdle', 'Finish run'],
    ['RunDone', 'Finish run'],
  ] as [RunDetailKey, string][])('Stop session sits between Finish run and Cancel run on %s', (k, finish) => {
    show(k);
    const names = topBarNames();
    const i = names.indexOf(finish);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(names.slice(i, i + 3)).toEqual([finish, 'Stop session', 'Cancel run']);
  });

  it.each(['RunPaused', 'RunSucceeded', 'RunFailed', 'RunStopped'] as RunDetailKey[])('is absent on %s', (k) => {
    show(k);
    expect(screen.queryByRole('button', { name: 'Stop session' })).not.toBeInTheDocument();
  });

  it('is disabled with the title The session is already ending while the session ends', () => {
    render(<RunDetail data={runDetails.RunIdleEnding} />);
    const stop = screen.getByRole('button', { name: 'Stop session' });
    expect(stop).toBeDisabled();
    expect(stop).toHaveAttribute('title', STOP_TITLE);
  });

  it('is enabled on a running run and has no title', () => {
    show('RunRunning');
    const stop = screen.getByRole('button', { name: 'Stop session' });
    expect(stop).toBeEnabled();
    expect(stop).not.toHaveAttribute('title');
  });

  it.each([
    ['a cancel or finish', { pendingNote: 'Finishing…' }],
    ['a resume', { resuming: true }],
    ['a stop', { stopping: true }],
  ] as [string, Partial<React.ComponentProps<typeof RunDetail>>][])(
    'is disabled while %s is in flight',
    (_n, extra) => {
      show('RunIdle', extra);
      expect(screen.getByRole('button', { name: 'Stop session' })).toBeDisabled();
    },
  );

  it('on a running run it calls onStopOpen; on idle and done it calls onStop', async () => {
    const onStopOpen = vi.fn();
    const onStop = vi.fn();
    const { unmount } = show('RunRunning', { onStopOpen, onStop });
    await userEvent.click(screen.getByRole('button', { name: 'Stop session' }));
    expect(onStopOpen).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    unmount();
    for (const k of ['RunIdle', 'RunDone'] as RunDetailKey[]) {
      const r = show(k, { onStopOpen, onStop });
      await userEvent.click(screen.getByRole('button', { name: 'Stop session' }));
      r.unmount();
    }
    expect(onStop).toHaveBeenCalledTimes(2);
    expect(onStopOpen).toHaveBeenCalledTimes(1);
  });

  it('the confirm is absent by default', () => {
    show('RunRunning');
    expect(screen.queryByRole('dialog', { name: 'Stop the session?' })).not.toBeInTheDocument();
  });

  it('the confirm stays closed when the run is no longer stoppable or is ending, even if it was open', () => {
    const r = show('RunPaused', { stopConfirmOpen: true });
    expect(screen.queryByRole('dialog', { name: 'Stop the session?' })).not.toBeInTheDocument();
    r.unmount();
    show('RunRunning', { stopConfirmOpen: true, data: { ...runDetails.RunRunning, pausing: true } });
    expect(screen.queryByRole('dialog', { name: 'Stop the session?' })).not.toBeInTheDocument();
  });

  it('the confirm has the title, the body with the keep time, Keep running and Stop session; Escape and Keep running call onStopClose; Stop session calls onStop', async () => {
    const onStopClose = vi.fn();
    const onStop = vi.fn();
    show('RunRunningStop', { stopConfirmOpen: true, onStopClose, onStop });
    const dialog = screen.getByRole('dialog', { name: 'Stop the session?' });
    expect(within(dialog).getByText('Stop the session?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'The agent is in the middle of a step. Stopping now cuts that step short. Everything up to now is kept, and you can resume for 7 days.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep running' }));
    expect(onStopClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onStopClose).toHaveBeenCalledTimes(2);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop session' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('RunDetail paused notice, automatic resume gave up', () => {
  const GAVE_UP = 'Tried to resume automatically 5 times.';
  const stopped = runDetails.RunStopped;
  const gaveUp = {
    ...stopped,
    session: { ...stopped.session, state: 'paused', autoResumeGaveUp: GAVE_UP },
  } as const;

  it('shows the line after the detail line, beside Resume and Finish', () => {
    render(<RunDetail data={gaveUp} onResume={() => {}} />);
    const detail = screen.getByText(stopped.session?.detail ?? 'missing detail');
    const line = screen.getByText(GAVE_UP);
    expect(detail.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
  });

  it('without it the notice is unchanged', () => {
    render(<RunDetail data={stopped} onResume={() => {}} />);
    expect(screen.queryByText(/Tried to resume automatically/)).not.toBeInTheDocument();
  });
});

describe('PR state colours on Run detail', () => {
  it('the top bar, Ticket card, chain step and Pull request section of a merged PR read "Merged"', () => {
    render(<RunDetail data={runDetailPrMerged} lines={terminalByRun[62]} />);
    expect(screen.getAllByRole('img', { name: 'Merged' })).toHaveLength(4);
  });

  it('the collapsed rail names the state', () => {
    render(<RunDetail data={runDetailPrMerged} lines={terminalByRun[62]} panelCollapsed />);
    const item = screen.getByRole('img', { name: 'Merged PR #148' });
    expect(item.querySelector('svg')?.parentElement).toHaveClass('prMerged');
  });

  it('an issue run keeps the issue icon everywhere', () => {
    show('RunRunning');
    expect(screen.queryByRole('img', { name: /^(Open|Draft|Merged|Closed)$/ })).not.toBeInTheDocument();
  });

  it('an unknown PR keeps "PR #148" on the rail', () => {
    render(<RunDetail data={runDetails.RunIdle} lines={terminalByRun[62]} panelCollapsed />);
    expect(screen.getByRole('img', { name: 'PR #148' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Merged PR #148' })).not.toBeInTheDocument();
  });
});

describe('RunDetail under the app bar (BR-46)', () => {
  const org: OrgSwitchProps = {
    ...orgSwitchFixtures.oneOrgSettings,
    orgHref: (o) => `/o/${o.slug}`,
    createHref: '/orgs/new',
  };
  const run = { runsHref: '/o/acme/p/1/runs', label: 'Run 61' };

  it('with org and run: the crumbs read org / project / Runs / Run 61, Runs links to run.runsHref, with the bell', () => {
    show('RunRunning', { org, run });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs).toHaveTextContent(/^Acme\/invoicer-api\/Runs\/Run 61$/);
    expect(
      within(crumbs).getByRole('button', { name: /^Switch scope, currently organization Acme/ }),
    ).toBeInTheDocument();
    expect(within(crumbs).getByRole('button', { name: /invoicer-api/ })).toBeInTheDocument();
    expect(within(crumbs).getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/o/acme/p/1/runs');
    expect(within(crumbs).getByText('Run 61')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Notifications on' })).toBeInTheDocument();
  });

  it('uses the given project name in the project crumb', () => {
    show('RunRunning', { org, run, projectName: 'forecast' });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('button', { name: /forecast/ })).toBeInTheDocument();
  });

  it('without org and run: the crumbs default to the project, Runs and the run number (no org menu)', () => {
    show('RunRunning');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).queryByRole('button', { name: /organization/i })).toBeNull();
    expect(within(crumbs).getByRole('button', { name: /invoicer-api/ })).toBeInTheDocument();
    expect(within(crumbs).getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/runs');
    expect(within(crumbs).getByText('Run 61')).toHaveAttribute('aria-current', 'page');
  });

  it('keeps one main', () => {
    show('RunRunning', { org, run });
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('the run bar has crumbs only: no Main tab list (TC-43.5)', () => {
    show('RunRunning', { org, run });
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Organization sections' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Project sections' })).toBeNull();
  });

  it('the project crumb opens the project switcher with projectMenu (TC-46.3)', async () => {
    show('RunRunning', {
      org,
      run,
      projectMenu: {
        status: 'ready',
        items: [
          { name: 'invoicer-api', needsYou: 1, current: true, href: '/p/api' },
          { name: 'docs-site', needsYou: 0, href: '/p/docs' },
        ],
      },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: /^Switch project/ }));
    expect(screen.getByRole('link', { name: /docs-site/ })).toHaveAttribute('href', '/p/docs');
  });
});

describe('RunDetail usage boards', () => {
  it('shows the Usage section before the chain, with the note once', () => {
    render(<RunDetail data={runUsageDetails.RunSucceededUsage} lines={terminalByRun[60]} />);
    const usage = screen.getByText('Usage', { selector: 'span, div, h2, h3' });
    const chain = screen.getByText('Chain on this ticket');
    expect(usage.compareDocumentPosition(chain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(/Estimate at public API rates/)).toHaveLength(1);
  });

  it('truncates a long model name and keeps it in the title', () => {
    render(<RunDetail data={runUsageDetails.RunSucceededUsageUnpriced} lines={terminalByRun[60]} />);
    const usage = runUsageDetails.RunSucceededUsageUnpriced.usage;
    if (usage?.state !== 'data') throw new Error('expected data');
    const long = usage.models[1].name;
    expect(screen.getByRole('rowheader', { name: long })).toHaveAttribute('title', long);
  });

  it('shows no usage numbers for a run with none', () => {
    render(<RunDetail data={runUsageDetails.RunSucceededUsageNone} lines={terminalByRun[60]} />);
    expect(screen.getByText('No usage data for this run.')).toBeInTheDocument();
  });
});
