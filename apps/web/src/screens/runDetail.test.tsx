import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { runDetails, terminalByRun } from '@/mocks';
import type { RunDetailKey } from '@/mocks';
import { RunDetail } from './RunDetail';

const linesFor = (k: RunDetailKey) => terminalByRun[runDetails[k].run.id];
const show = (k: RunDetailKey, extra: Partial<React.ComponentProps<typeof RunDetail>> = {}) =>
  render(<RunDetail data={runDetails[k]} lines={linesFor(k)} needsYou={1} {...extra} />);

const ended: RunDetailKey[] = ['RunSucceeded', 'RunFailed', 'RunTimedOut', 'RunCancelled'];
const FINISH_TITLE = 'Finish is available when the agent is waiting for you';

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

  it.each(ended)('%s: no Cancel run or Finish, View ticket links to the ticket', (k) => {
    show(k);
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Finish/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View ticket' })).toHaveAttribute('href', runDetails[k].run.ticket.href);
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

describe('RunDetail top bar elapsed', () => {
  it.each([
    ['RunStarting', '0:24'],
    ['RunRunning', '7:40'],
    ['RunIdle', '4:51'],
    ['RunReconnect', '9:02'],
    ['RunSucceeded', '6m 12s'],
    ['RunFailed', '1m 10s'],
    ['RunTimedOut', '30m 00s'],
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
    expect(screen.getByText(/None yet\. A link appears here/)).toBeInTheDocument();
  });

  it('running: live terminal, time meter, lifecycle, empty pull request', () => {
    show('RunRunning');
    expect(screen.getByRole('log', { name: 'Claude Code terminal' })).toBeInTheDocument();
    expect(screen.getByText('Live, attached as kim-hale')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '26% of run time limit used' })).toBeInTheDocument();
    expect(screen.getByText('Lifecycle')).toBeInTheDocument();
    expect(screen.getByText('Claude Code started')).toBeInTheDocument();
  });

  it('idle: amber notice, cursor, Waiting for you with the amber timer note', () => {
    const { container } = show('RunIdle');
    expect(screen.getByText('The agent finished its turn and is waiting for you')).toBeInTheDocument();
    expect(container.querySelector('[class*="cursor"]')).not.toBeNull();
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
    expect(screen.getByText('Timer paused')).toBeInTheDocument();
    expect(screen.getByText('14:13:58')).toBeInTheDocument();
    expect(screen.getByText('14:26')).toBeInTheDocument();
    expect(screen.getByText('It holds 1 of 2 slots. Run 63 is queued behind it.')).toBeInTheDocument();
  });

  it('succeeded: ok banner with Go to run 62, Final scrollback, pull request with diffstat', () => {
    const { container } = show('RunSucceeded');
    expect(screen.getByText('Succeeded in 6m 12s.').closest('[class*="banner"]')).toHaveClass('ok', 'flush');
    expect(screen.getByRole('link', { name: 'Go to run 62' })).toHaveAttribute('href', '/runs/62');
    expect(screen.getByRole('tab', { name: /Final scrollback/ })).toBeInTheDocument();
    expect(screen.getByText('+214 −12')).toBeInTheDocument();
    expect(container.querySelector('[class*="cursor"]')).toBeNull();
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
    const banner = screen.getByText('Timed out at the 30 minute limit').closest('[class*="banner"]')!;
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

  it('links set the breadcrumb and Desk hrefs; cancelBody replaces the confirmation text', () => {
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
    expect(within(crumbs).getByRole('link', { name: 'invoicer-api' })).toHaveAttribute('href', '/o/a/projects');
    expect(within(crumbs).getByRole('link', { name: /^Runs/ })).toHaveAttribute('href', '/o/a/p/1/runs');
    expect(screen.getByRole('link', { name: 'code-build' })).toHaveAttribute('href', '/o/a/p/1/desk/skills');
    expect(screen.getByRole('dialog')).toHaveTextContent('Stops the pod.');
  });
});
