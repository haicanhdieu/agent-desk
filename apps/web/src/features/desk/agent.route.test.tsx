import { AGENT_KIND_CAPABILITIES, AGENT_TEST_MESSAGES } from '@agentdesk/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tenantAccessFixtures } from '@/mocks/dto/access';
import { ids } from '@/mocks/dto/ids';
import { routeHandler } from '@/mocks/msw/http';
import { defaultTriggerState, mockDb } from '@/mocks/msw/db';
import { applyProjectSpace, type ProjectSpaceRole } from '@/mocks/msw/projectSpaceScenarios';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

const projectId = ids.project.invoicerApi;
const agentPage = `/o/alice/p/${projectId}/desk/agent`;
const projectPath = `/api/projects/${projectId}`;

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

let stopCapture: (() => void) | undefined;
afterEach(() => {
  stopCapture?.();
  stopCapture = undefined;
});

/** Records the writes (method, pathname, JSON body) the app sends, in order. */
function captureWrites() {
  const sent: Sent[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method === 'GET') return;
    const path = new URL(request.url).pathname;
    const entry: Sent = { method: request.method, path, body: undefined };
    sent.push(entry);
    void request
      .clone()
      .text()
      .then((t) => {
        entry.body = t === '' ? undefined : (JSON.parse(t) as unknown);
      });
  };
  server.events.on('request:start', listener);
  stopCapture = () => server.events.removeListener('request:start', listener);
  return sent;
}

const projectRow = () => {
  const row = mockDb.state.projects.find((p) => p.id === projectId);
  if (!row) throw new Error('project not in the mock store');
  return row;
};

/** Opens the screen and then the named tab (the screen starts on Agents; every setting here sits on another tab). */
async function openPage(tab: 'Limits' | 'GitHub connection' | 'Danger zone' = 'Limits') {
  const rendered = await renderRoute(agentPage);
  expect(await screen.findByRole('heading', { level: 1, name: 'Agent & settings' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: tab }));
  // The tab is in the URL: it shows once the navigation settles.
  await waitFor(() => expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true'));
  return rendered;
}

const field = (label: string) => screen.getByLabelText(label);
const unitSelect = () => screen.getByLabelText('Run time limit unit');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('desk agent route', () => {
  it('shows the limits and the connection from the API', async () => {
    const { user } = await openPage();
    expect(field('Run time limit')).toHaveValue('24');
    expect(unitSelect()).toHaveValue('hours');
    expect(field('Concurrent runs')).toHaveValue('2');
    expect(field('Runs per ticket')).toHaveValue('10');
    await user.click(screen.getByRole('tab', { name: 'GitHub connection' }));
    expect(screen.getByText('harbor-labs/invoicer-api', { selector: '.mono' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Webhook' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a 500 on the agent list shows the error banner with Retry', async () => {
    await renderRoute(agentPage, { scenario: () => scenarios.agents('listError') });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows a 24 h limit as 24 hours', async () => {
    projectRow().timeoutSeconds = 86400;
    await openPage();
    expect(field('Run time limit')).toHaveValue('24');
    expect(unitSelect()).toHaveValue('hours');
  });

  it('shows a 7 day limit as 7 days', async () => {
    projectRow().timeoutSeconds = 604800;
    await openPage();
    expect(field('Run time limit')).toHaveValue('7');
    expect(unitSelect()).toHaveValue('days');
  });

  it('saving 2 days sends 172800 seconds; saving 30 hours sends 108000', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    const timeout = field('Run time limit');
    await user.selectOptions(unitSelect(), 'days');
    await user.clear(timeout);
    await user.type(timeout, '2');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Limits saved')).toBeInTheDocument();
    await waitFor(() => expect(sent.every((s) => s.body !== undefined)).toBe(true));
    expect(sent).toEqual([{ method: 'PATCH', path: projectPath, body: { timeoutSeconds: 172800 } }]);
    expect(projectRow().timeoutSeconds).toBe(172800);

    sent.length = 0;
    await user.selectOptions(unitSelect(), 'hours');
    await user.clear(timeout);
    await user.type(timeout, '30');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    await waitFor(() => expect(projectRow().timeoutSeconds).toBe(108000));
  });

  it('a limit above 7 days is refused: the /timeoutSeconds message shows on Run time limit and the form stays filled', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    const timeout = field('Run time limit');
    await user.selectOptions(unitSelect(), 'days');
    await user.clear(timeout);
    await user.type(timeout, '8');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));

    await waitFor(() => expect(timeout).toHaveAttribute('aria-invalid', 'true'));
    const describedBy = timeout.getAttribute('aria-describedby') ?? '';
    const messages = describedBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(messages).toMatch(/7 days/);
    expect(timeout).toHaveValue('8');
    expect(unitSelect()).toHaveValue('days');
    expect(sent.filter((s) => s.method === 'PATCH' && s.path === projectPath)).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({ timeoutSeconds: 691200 });
    expect(projectRow().timeoutSeconds).toBe(86400);
  });

  it('shows the keep times from the project: 7 days and 24 hours', async () => {
    await openPage();
    expect(field('Keep a paused run for')).toHaveValue('7');
    expect(screen.getByLabelText('Keep a paused run for unit')).toHaveValue('days');
    expect(field("Keep a finished run's session for")).toHaveValue('24');
    expect(screen.getByLabelText("Keep a finished run's session for unit")).toHaveValue('hours');
    expect(screen.getByText('After this, a paused run expires and its saved session is deleted.')).toBeInTheDocument();
    expect(screen.getByText('How long a finished run can be reopened. 0 turns this off.')).toBeInTheDocument();
  });

  it('saving 3 days for a paused run sends pausedKeepSeconds 259200', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    const paused = field('Keep a paused run for');
    await user.clear(paused);
    await user.type(paused, '3');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Limits saved')).toBeInTheDocument();
    await waitFor(() => expect(sent.every((s) => s.body !== undefined)).toBe(true));
    expect(sent).toEqual([{ method: 'PATCH', path: projectPath, body: { pausedKeepSeconds: 259200 } }]);
    expect(projectRow().pausedKeepSeconds).toBe(259200);
  });

  it('shows the idle end from the agent as an editable field', async () => {
    await openPage();
    const idle = field('End idle runs after');
    expect(idle).toHaveValue('30');
    expect(idle).not.toHaveAttribute('readonly');
  });

  it('saving 90 minutes for idle runs sends idleEndSeconds 5400 and shows it after a reload', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    const idle = field('End idle runs after');
    await user.clear(idle);
    await user.type(idle, '90');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Limits saved')).toBeInTheDocument();
    await waitFor(() => expect(sent.every((s) => s.body !== undefined)).toBe(true));
    expect(sent).toEqual([{ method: 'PATCH', path: projectPath, body: { idleEndSeconds: 5400 } }]);
    expect(projectRow().idleEndSeconds).toBe(5400);
    expect(field('End idle runs after')).toHaveValue('90');
  });

  it('2 minutes for idle runs shows the contract message and saves nothing', async () => {
    const { user } = await openPage();
    const idle = field('End idle runs after');
    await user.clear(idle);
    await user.type(idle, '2');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Idle runs must end after between 5 minutes and 7 days')).toBeInTheDocument();
    expect(idle).toHaveAttribute('aria-invalid', 'true');
    expect(idle).toHaveValue('2');
    expect(screen.queryByText('Limits saved')).toBeNull();
    expect(projectRow().idleEndSeconds).toBe(1800);
  });

  it('saving 2 automatic resumes sends autoResumeMax 2 and shows it after a reload', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    const resumes = field('Automatic resumes after a crash');
    expect(resumes).toHaveValue('5');
    await user.clear(resumes);
    await user.type(resumes, '2');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Limits saved')).toBeInTheDocument();
    await waitFor(() => expect(sent.every((s) => s.body !== undefined)).toBe(true));
    expect(sent).toEqual([{ method: 'PATCH', path: projectPath, body: { autoResumeMax: 2 } }]);
    expect(projectRow().autoResumeMax).toBe(2);
    expect(field('Automatic resumes after a crash')).toHaveValue('2');
  });

  it('12 automatic resumes shows "Automatic resumes must be between 0 and 10" on the field and saves nothing', async () => {
    const { user } = await openPage();
    const resumes = field('Automatic resumes after a crash');
    await user.clear(resumes);
    await user.type(resumes, '12');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Automatic resumes must be between 0 and 10')).toBeInTheDocument();
    expect(resumes).toHaveAttribute('aria-invalid', 'true');
    expect(resumes).toHaveValue('12');
    expect(screen.queryByText('Limits saved')).toBeNull();
    expect(projectRow().autoResumeMax).toBe(5);
  });

  it('0 for a finished run sends doneKeepSeconds 0', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    const done = field("Keep a finished run's session for");
    await user.clear(done);
    await user.type(done, '0');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Limits saved')).toBeInTheDocument();
    await waitFor(() => expect(sent.every((s) => s.body !== undefined)).toBe(true));
    expect(sent).toEqual([{ method: 'PATCH', path: projectPath, body: { doneKeepSeconds: 0 } }]);
    expect(projectRow().doneKeepSeconds).toBe(0);
  });

  it('31 days for a paused run shows the contract message and saves nothing', async () => {
    const { user } = await openPage();
    const paused = field('Keep a paused run for');
    await user.selectOptions(screen.getByLabelText('Keep a paused run for unit'), 'days');
    await user.clear(paused);
    await user.type(paused, '31');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('A paused run must be kept between 1 hour and 30 days')).toBeInTheDocument();
    expect(paused).toHaveAttribute('aria-invalid', 'true');
    expect(paused).toHaveValue('31');
    expect(screen.queryByText('Limits saved')).toBeNull();
    expect(projectRow().pausedKeepSeconds).toBe(604800);
  });

  it('saving limits sends only the changed fields in one project request, never a stale value', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    // Someone changes the runs-per-ticket limit after the page loaded.
    projectRow().maxRunsPerTicket = 20;
    const concurrent = field('Concurrent runs');
    await user.clear(concurrent);
    await user.type(concurrent, '3');
    const timeout = field('Run time limit');
    await user.clear(timeout);
    await user.type(timeout, '45');
    await user.selectOptions(unitSelect(), 'minutes');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));

    expect(await screen.findByText('Limits saved')).toBeInTheDocument();
    await waitFor(() => expect(sent.every((s) => s.body !== undefined)).toBe(true));
    expect(sent).toEqual([
      { method: 'PATCH', path: projectPath, body: { maxConcurrentRuns: 3, timeoutSeconds: 2700 } },
    ]);
    expect(projectRow()).toMatchObject({ maxConcurrentRuns: 3, maxRunsPerTicket: 20, timeoutSeconds: 2700 });
  });

  it('nothing changed: Save limits sends nothing and shows no toast', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    await sleep(50);
    expect(sent).toHaveLength(0);
    expect(screen.queryByText('Limits saved')).toBeNull();
  });

  it('a refused limit saves nothing; the retry sends the changed fields once they are valid', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    const concurrent = field('Concurrent runs');
    await user.clear(concurrent);
    await user.type(concurrent, '3');
    const timeout = field('Run time limit');
    await user.selectOptions(unitSelect(), 'days');
    await user.clear(timeout);
    await user.type(timeout, '8');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));

    await waitFor(() => expect(timeout).toHaveAttribute('aria-invalid', 'true'));
    expect(concurrent).not.toHaveAttribute('aria-invalid');
    expect(projectRow().maxConcurrentRuns).toBe(2);
    expect(screen.queryByText('Limits saved')).toBeNull();

    sent.length = 0;
    await user.selectOptions(unitSelect(), 'minutes');
    await user.clear(timeout);
    await user.type(timeout, '45');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Limits saved')).toBeInTheDocument();
    await waitFor(() => expect(sent.every((x) => x.body !== undefined)).toBe(true));
    expect(sent).toEqual([
      { method: 'PATCH', path: projectPath, body: { maxConcurrentRuns: 3, timeoutSeconds: 2700 } },
    ]);
    expect(timeout).not.toHaveAttribute('aria-invalid');
  });

  it('a double click on Save limits sends one save', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    const concurrent = field('Concurrent runs');
    await user.clear(concurrent);
    await user.type(concurrent, '4');
    const save = screen.getByRole('button', { name: 'Save limits' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(await screen.findByText('Limits saved')).toBeInTheDocument();
    expect(sent.filter((s) => s.method === 'PATCH')).toHaveLength(1);
  });

  it('switching to polling every 30 min sends pollIntervalSeconds 1800 and the connection status refetches', async () => {
    const sent = captureWrites();
    const { user } = await openPage('GitHub connection');
    const connectionBefore = mockDb.requests('GET', `${projectPath}/connection`);
    await user.click(screen.getByRole('radio', { name: 'Polling' }));
    const interval = screen.getByRole('radiogroup', { name: 'Check every' });
    await user.click(within(interval).getByRole('radio', { name: '30 min' }));

    await waitFor(() => expect(projectRow()).toMatchObject({ triggerMode: 'polling', pollIntervalSeconds: 1800 }));
    await waitFor(() => expect(sent.at(-1)?.body).toBeDefined());
    expect(sent.at(-1)).toMatchObject({
      method: 'PATCH',
      path: projectPath,
      body: { triggerMode: 'polling', pollIntervalSeconds: 1800 },
    });
    await waitFor(() => expect(mockDb.requests('GET', `${projectPath}/connection`)).toBeGreaterThan(connectionBefore));
    expect(await screen.findByText('Polling every 30 min')).toBeInTheDocument();
    expect(within(interval).getByRole('radio', { name: '30 min' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a failed trigger mode change goes back to the saved mode and shows the problem title', async () => {
    const { user } = await openPage('GitHub connection');
    scenarios.problem('projects.update', {
      status: 503,
      title: 'Polling unavailable',
      detail: 'The poller is restarting; try again in a minute.',
    });
    await user.click(screen.getByRole('radio', { name: 'Polling' }));
    expect(await screen.findByText('Polling unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/The poller is restarting/)).toBeNull();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Webhook' })).toHaveAttribute('aria-checked', 'true'));
    expect(projectRow().triggerMode).toBe('webhook');
  });

  it('an older trigger save failing late does not undo a newer pick', async () => {
    let call = 0;
    server.use(
      http.patch(`*${projectPath}`, async () => {
        call += 1;
        if (call !== 1) return undefined;
        await sleep(80);
        return HttpResponse.json(
          { type: 'urn:agentdesk:problem:internal', title: 'Internal server error', status: 500 },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        );
      }),
    );
    const { user } = await openPage('GitHub connection');
    await user.click(screen.getByRole('radio', { name: 'Polling' }));
    const interval = screen.getByRole('radiogroup', { name: 'Check every' });
    await user.click(within(interval).getByRole('radio', { name: '30 min' }));

    await waitFor(() => expect(projectRow()).toMatchObject({ triggerMode: 'polling', pollIntervalSeconds: 1800 }));
    expect(await screen.findByText('Polling every 30 min')).toBeInTheDocument();
    expect(call).toBe(2);
    expect(screen.queryByText('Internal server error')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Polling' })).toHaveAttribute('aria-checked', 'true');
    expect(within(interval).getByRole('radio', { name: '30 min' })).toHaveAttribute('aria-checked', 'true');
  });

  it('delete asks to confirm, removes the project and goes to the projects list', async () => {
    const { user, router } = await openPage('Danger zone');
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete project' });
    // Cancel keeps the project.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockDb.state.projects.some((p) => p.id === projectId)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete project' })).getByRole('button', { name: 'Delete project' }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/alice/projects'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(mockDb.state.projects.some((p) => p.id === projectId)).toBe(false);
    expect(screen.queryByRole('link', { name: 'invoicer-api' })).toBeNull();
  });
});

describe('desk agent route: Check now', () => {
  const pollPath = `${projectPath}/connection/poll`;
  const checkNow = () => screen.getByRole('button', { name: /^Check(ing)?( now|…)?$/ });
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  /** The project polls every 5 min and was last checked 3 hours ago; `polling` overrides the cursor. */
  function pollingProject(polling: Partial<ReturnType<typeof defaultTriggerState>['polling']> = {}) {
    Object.assign(projectRow(), { triggerMode: 'polling', pollIntervalSeconds: 300 });
    const state = defaultTriggerState();
    mockDb.state.triggers[projectId] = {
      ...state,
      polling: { ...state.polling, lastCheckedAt: hoursAgo(3), ...polling },
    };
  }

  it('a double click sends one poll request, shows Checking while it runs, then shows the new Last checked time', async () => {
    pollingProject();
    // A held poll, so the in-flight state can be seen; the test releases it, and it then moves Last checked.
    let sent = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(pollPath, async () => {
        sent += 1;
        await gate;
        const polling = mockDb.state.triggers[projectId]?.polling;
        if (polling) polling.lastCheckedAt = new Date().toISOString();
        return new HttpResponse(null, { status: 202 });
      }),
    );
    await openPage('GitHub connection');
    expect(screen.getByText('3 hours ago (polling)')).toBeInTheDocument();
    const button = checkNow();
    fireEvent.click(button);
    fireEvent.click(button);
    // The query library publishes the pending state on the next timer tick; both clicks above landed before it.
    await act(() => sleep(0));
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    release();
    expect(await screen.findByText('just now (polling)')).toBeInTheDocument();
    await waitFor(() => expect(checkNow()).toBeEnabled());
    expect(checkNow()).toHaveTextContent('Check now');
    expect(sent).toBe(1);
  });

  const tick = () => act(() => vi.advanceTimersByTimeAsync(10));

  it('keeps Checking until the poll it started lands, even when the page shows an older Last checked than the server', async () => {
    let stopReads: (() => void) | undefined;
    try {
      pollingProject();
      await openPage('GitHub connection');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      expect(screen.getByText('3 hours ago (polling)')).toBeInTheDocument();
      // A scheduled poll ran after the page loaded: the server is ahead of the page's cache.
      const state = mockDb.state.triggers[projectId];
      if (state) state.polling.lastCheckedAt = hoursAgo(1);
      let sent = 0;
      let statusReads = 0;
      const onRequest = ({ request }: { request: Request }) => {
        if (request.method === 'GET' && new URL(request.url).pathname === `${projectPath}/connection`) statusReads += 1;
      };
      server.events.on('request:start', onRequest);
      stopReads = () => server.events.removeListener('request:start', onRequest);
      // The poll is accepted at once; its result lands only when the test says so.
      server.use(
        http.post(pollPath, () => {
          sent += 1;
          return new HttpResponse(null, { status: 202 });
        }),
      );
      fireEvent.click(checkNow());
      // Fake time stands still, so step it in small slices while the mocked requests settle.
      for (let i = 0; i < 100 && (sent < 1 || statusReads < 1); i += 1) await tick();
      expect(sent).toBe(1);
      expect(statusReads).toBeGreaterThan(0);
      await tick();
      // Only the older poll has finished so far: that is not this poll's result.
      expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
      const polling = mockDb.state.triggers[projectId]?.polling;
      if (polling) polling.lastCheckedAt = new Date().toISOString();
      for (let i = 0; i < 300 && checkNow().hasAttribute('disabled'); i += 1) await tick();
      expect(screen.getByText('just now (polling)')).toBeInTheDocument();
      expect(checkNow()).toBeEnabled();
    } finally {
      stopReads?.();
      vi.useRealTimers();
    }
  });

  it('while polling is paused it shows the reason, sends no successful poll and leaves Last checked alone', async () => {
    pollingProject({ pausedReason: 'token_revoked', lastError: 'rejected' });
    const { user } = await openPage('GitHub connection');
    await user.click(checkNow());
    expect(await screen.findByRole('alert')).toHaveTextContent('Polling is paused: token_revoked');
    expect(screen.getByText('3 hours ago (polling)')).toBeInTheDocument();
    expect(checkNow()).toBeEnabled();
  });

  it('a server error shows a message and the button is usable again', async () => {
    pollingProject();
    const { user } = await openPage('GitHub connection');
    scenarios.serverError('projects.pollNow');
    await user.click(checkNow());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start the check');
    expect(checkNow()).toBeEnabled();
  });
});

describe('desk agent route: Delete project gate (BR-21)', () => {
  const openAs = async (role: ProjectSpaceRole) => {
    const rendered = await renderRoute(agentPage, { scenario: () => applyProjectSpace(mockDb, { role }) });
    expect(await screen.findByRole('heading', { level: 1, name: 'Agent & settings' })).toBeInTheDocument();
    return rendered;
  };

  it('shows no Delete project control to an admin of this project only', async () => {
    await openAs('projectAdmin');
    expect(screen.queryByRole('tab', { name: 'Danger zone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete project' })).not.toBeInTheDocument();
    expect(screen.queryByText('Danger zone')).not.toBeInTheDocument();
  });

  it.each(['owner', 'admin'] as const)('still shows Delete project to the %s', async (role) => {
    const { user } = await openAs(role);
    await user.click(screen.getByRole('tab', { name: 'Danger zone' }));
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeInTheDocument();
  });
});

// The Agents tab: add, edit, test, set default and delete (spec 2026-11-24 multi-agent configs, BR-6 to BR-30, BR-66).
describe('desk agent route: agents', () => {
  const secret = 'sk-ant-oat01-replace-me-0123456789';
  const agentNamed = (name: string) => {
    const row = mockDb.state.agents.find((a) => a.projectId === projectId && a.name === name);
    if (!row) throw new Error(`agent ${name} not in the mock store`);
    return row;
  };
  const writes = (sent: Sent[]) => sent.map((s) => `${s.method} ${s.path.replace(/[0-9a-f-]{36}/g, ':id')}`);

  async function openAgents(scenario?: () => void) {
    const rendered = await renderRoute(agentPage, {
      scenario: () => (scenario ?? (() => scenarios.agents('perAgentModels')))(),
    });
    await screen.findByText('Claude - Personal');
    return rendered;
  }
  const paneHeading = (name: string) => screen.findByRole('heading', { level: 2, name });
  const rowOf = (name: string) => {
    const li = screen
      .getAllByText(name)
      .map((el) => el.closest('li'))
      .find((el) => el !== null);
    if (!li) throw new Error(`no row for ${name}`);
    return li;
  };
  const modelSelect = () => screen.getByRole('combobox', { name: 'Default model' });
  const modelOptions = () => Array.from(modelSelect().querySelectorAll('option')).map((o) => o.textContent);
  const typeInto = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  async function openMenu(user: Awaited<ReturnType<typeof renderRoute>>['user'], name: string) {
    await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  }

  it('the add flow sends create with the model, the credential and the test, and no PATCH (BR-6)', async () => {
    const sent = captureWrites();
    const { user, router } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await paneHeading('Add agent');
    await user.click(screen.getByRole('radio', { name: 'Claude Code' }));
    await user.type(screen.getByLabelText('Name'), 'Claude - Fresh');
    await user.type(screen.getByLabelText('Account label'), 'Fresh');
    await user.type(screen.getByLabelText('Subscription token'), secret);
    await user.type(screen.getByLabelText('Model name'), 'claude-sonnet-4-5');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));

    expect(await screen.findByText('Agent saved')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: 'Add agent' })).toBeNull());
    await waitFor(() => expect(sent.every((s) => s.method === 'POST' || s.body !== undefined)).toBe(true));
    expect(writes(sent)).toEqual([
      'POST /api/projects/:id/agents',
      'PUT /api/agents/:id/credential',
      'POST /api/agents/:id/test',
    ]);
    expect(sent[0]?.body).toEqual({
      provider: 'claude',
      name: 'Claude - Fresh',
      accountLabel: 'Fresh',
      model: 'claude-sonnet-4-5',
    });
    expect(sent[1]?.body).toEqual({ type: 'oauth_token', value: secret });
    expect(await screen.findByText('Claude - Fresh')).toBeInTheDocument();
    expect(router.state.location.search).not.toHaveProperty('agent');
  });

  it('the secret is in no query or mutation cache entry, nor in the page after the pane closes (BR-12)', async () => {
    const { user, queryClient } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'Claude Code' }));
    await user.type(screen.getByLabelText('Name'), 'Claude - Cache');
    await user.type(screen.getByLabelText('Subscription token'), secret);
    await user.type(screen.getByLabelText('Model name'), 'opus');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Agent saved')).toBeInTheDocument();
    const queries = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    );
    const mutations = JSON.stringify(
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => [m.state, m.options.mutationKey]),
    );
    expect(queries).not.toContain(secret);
    expect(mutations).not.toContain(secret);
    expect(document.body.textContent).not.toContain(secret);
    expect(document.body.innerHTML).not.toContain(secret);
  });

  it('a later edit that picks a discovered model sends one PATCH (BR-6)', async () => {
    const sent = captureWrites();
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Edit Claude - Personal' }));
    await paneHeading('Edit agent');
    await waitFor(() => expect(modelOptions()).toContain('claude-sonnet-4-5'));
    await user.selectOptions(modelSelect(), 'claude-sonnet-4-5');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Agent saved')).toBeInTheDocument();
    await waitFor(() => expect(sent[0]?.body).toBeDefined());
    expect(writes(sent)).toEqual(['PATCH /api/agents/:id']);
    expect(sent[0]?.body).toEqual({ model: 'claude-sonnet-4-5' });
    expect(agentNamed('Claude - Personal').model).toBe('claude-sonnet-4-5');
  });

  it('an OpenCode add with nothing picked sends the create only; the row reads No credential and No sign-in (BR-68)', async () => {
    const sent = captureWrites();
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'OpenCode' }));
    await user.type(screen.getByLabelText('Name'), 'OpenCode - Bare');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Agent saved')).toBeInTheDocument();
    await waitFor(() => expect(sent[0]?.body).toBeDefined());
    expect(writes(sent)).toEqual(['POST /api/projects/:id/agents']);
    expect(sent[0]?.body).toEqual({ provider: 'opencode', name: 'OpenCode - Bare' });
    const row = rowOf('OpenCode - Bare');
    expect(within(row).getByText('OpenCode . No sign-in')).toBeInTheDocument();
    expect(within(row).getByText('No credential')).toBeInTheDocument();
  });

  it('an OpenCode credentials file sends PUT credential with auth_json and no baseUrl', async () => {
    const sent = captureWrites();
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'OpenCode' }));
    await user.type(screen.getByLabelText('Name'), 'OpenCode - File');
    await user.click(screen.getByRole('radio', { name: 'Credentials file' }));
    typeInto('Credentials file', '{"anthropic":{"type":"api","key":"k"}}');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Agent saved')).toBeInTheDocument();
    await waitFor(() => expect(sent.length).toBe(3));
    await waitFor(() => expect(sent[1]?.body).toBeDefined());
    expect(sent[1]).toMatchObject({
      method: 'PUT',
      body: { type: 'auth_json', value: '{"anthropic":{"type":"api","key":"k"}}' },
    });
    expect(sent[1]?.body).not.toHaveProperty('baseUrl');
  });

  it('an OpenCode endpoint and key send both together', async () => {
    const sent = captureWrites();
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'OpenCode' }));
    await user.type(screen.getByLabelText('Name'), 'OpenCode - Endpoint');
    await user.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    typeInto('API endpoint', 'https://llm.example.com/v1');
    typeInto('API key', secret);
    await user.type(screen.getByLabelText('Model name'), 'qwen3-coder');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Agent saved')).toBeInTheDocument();
    await waitFor(() => expect(sent[1]?.body).toBeDefined());
    expect(sent[1]?.body).toEqual({ type: 'api_key', value: secret, baseUrl: 'https://llm.example.com/v1' });
  });

  it.each([
    ['API endpoint', 'https://llm.example.com/v1', 'Enter the API key for this endpoint.'],
    ['API key', secret, 'Enter the API endpoint for this key.'],
  ])('an OpenCode %s alone shows its message and sends nothing (BR-69)', async (label, value, message) => {
    const sent = captureWrites();
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'OpenCode' }));
    await user.type(screen.getByLabelText('Name'), 'OpenCode - Half');
    await user.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    await user.type(screen.getByLabelText('Model name'), 'qwen3-coder');
    typeInto(label, value);
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('an OpenCode switch from a file to an endpoint and key asks for the credential again (BR-15)', async () => {
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Edit OpenCode - Credentials file' }));
    await paneHeading('Edit agent');
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await user.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    expect(screen.getByText('The authentication changed. Paste the new credential.')).toBeInTheDocument();
  });

  it('set default moves the chip and shows the Toast (BR-23)', async () => {
    const sent = captureWrites();
    const { user } = await openAgents();
    await openMenu(user, 'Codex');
    await user.click(screen.getByRole('button', { name: 'Set as default' }));
    expect(await screen.findByText('Default agent changed. New runs only.')).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('Codex')).getByText('Default')).toBeInTheDocument());
    expect(within(rowOf('Claude - Personal')).queryByText('Default')).toBeNull();
    expect(writes(sent)).toEqual(['POST /api/agents/:id/default']);
  });

  it('the editor checkbox sets the default the same way (BR-24)', async () => {
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Edit Codex' }));
    await paneHeading('Edit agent');
    await user.click(screen.getByRole('checkbox', { name: 'Use as the project default' }));
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Default agent changed. New runs only.')).toBeInTheDocument();
    expect(agentNamed('Codex').isDefault).toBe(true);
  });

  it('a failed set default shows the problem title', async () => {
    const { user } = await openAgents();
    scenarios.problem('agents.setDefault', { status: 500, title: 'Internal server error', type: 'internal' });
    await openMenu(user, 'Codex');
    await user.click(screen.getByRole('button', { name: 'Set as default' }));
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(agentNamed('Claude - Personal').isDefault).toBe(true);
  });

  it.each([
    ['testRejected', 'Credential rejected', 'rejected'],
    ['testUnreachable', "Can't reach address", 'unreachable'],
    ['testInvalid', "Can't verify", 'invalid'],
    ['testUnsupported', 'Not checkable', 'unsupported'],
  ] as const)('test connection under %s shows %s and the fixed message (BR-20)', async (scenario, word, status) => {
    const { user } = await openAgents(() => scenarios.agents(scenario));
    await openMenu(user, 'Claude - Personal');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(AGENT_TEST_MESSAGES[status])).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('Claude - Personal')).getByText(word)).toBeInTheDocument());
  });

  it('test connection that works shows Ready and Connected', async () => {
    const { user } = await openAgents();
    await openMenu(user, 'Claude - Work');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('Claude - Work')).getByText('Ready')).toBeInTheDocument());
  });

  it('the pane Test connection button tests the agent and updates the status', async () => {
    const { user } = await openAgents(() => scenarios.agents('testRejected'));
    await user.click(screen.getByRole('button', { name: 'Edit Claude - Personal' }));
    await paneHeading('Edit agent');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(AGENT_TEST_MESSAGES.rejected)).toBeInTheDocument();
    const pane = screen.getByRole('complementary');
    await waitFor(() => expect(within(pane).getByText('Credential rejected')).toBeInTheDocument());
  });

  it('adding Claude Code with a name and a token and no model sends create without a model; the row shows the first standard model (BR-6, TC-6.3)', async () => {
    const sent = captureWrites();
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'Claude Code' }));
    await user.type(screen.getByLabelText('Name'), 'Claude - NoModel');
    await user.type(screen.getByLabelText('Subscription token'), secret);
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Agent saved')).toBeInTheDocument();
    expect(screen.queryByText('Enter a model name.')).toBeNull();
    expect(sent[0]?.body).toEqual({ provider: 'claude', name: 'Claude - NoModel' });
    expect(agentNamed('Claude - NoModel').model).not.toBe('');
  });

  it('adding Codex and picking a standard name sends it as the model (BR-19, TC-6.3)', async () => {
    const sent = captureWrites();
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'OpenAI Codex' }));
    await user.type(screen.getByLabelText('Name'), 'Codex - Picked');
    const id = AGENT_KIND_CAPABILITIES.codex.builtinModels[1]?.id ?? '';
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default model' }), id);
    typeInto('auth.json contents', '{"tokens":{}}');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Agent saved')).toBeInTheDocument();
    expect(sent[0]?.body).toEqual({ provider: 'codex', name: 'Codex - Picked', model: id });
  });

  it('adding Codex with no model sends create without a model (BR-6)', async () => {
    const sent = captureWrites();
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'OpenAI Codex' }));
    await user.type(screen.getByLabelText('Name'), 'Codex - NoModel');
    typeInto('auth.json contents', '{"tokens":{}}');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Agent saved')).toBeInTheDocument();
    expect(sent[0]?.body).toEqual({ provider: 'codex', name: 'Codex - NoModel' });
  });

  it('a typed model that is cleared again shows "Enter a model name." and sends nothing', async () => {
    const sent = captureWrites();
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'Claude Code' }));
    await user.type(screen.getByLabelText('Name'), 'Claude - Cleared');
    await user.type(screen.getByLabelText('Model name'), 'x');
    await user.clear(screen.getByLabelText('Model name'));
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Enter a model name.')).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('delete confirms, removes the row and shows the Toast (BR-27)', async () => {
    const sent = captureWrites();
    const { user } = await openAgents();
    await openMenu(user, 'Codex');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('dialog', { name: 'Delete agent Codex?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete agent' }));
    expect(await screen.findByText('Agent deleted')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Codex', { selector: 'span, b, strong' })).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes(sent)).toEqual(['DELETE /api/agents/:id']);
  });

  const RUN_REFUSAL = 'Run 900 is paused and can be resumed. Finish it first, then delete.';
  const closeOnly = () =>
    expect(
      within(screen.getByRole('dialog'))
        .getAllByRole('button')
        .map((b) => b.textContent)
        .filter((t) => t === 'Close' || t === 'Delete agent' || t === 'Keep agent'),
    ).toEqual(['Close']);

  it('delete refused by a rule lists the rule commands and keeps the agent (BR-29)', async () => {
    const { user } = await openAgents(() => scenarios.agents('deleteBlocked'));
    await openMenu(user, 'Claude - Work');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete agent' }));
    expect(await screen.findByText('A routing rule uses this agent')).toBeInTheDocument();
    expect(
      screen.getByText(/1 rule names it: \/fix\. Point it at another agent first, then delete\./),
    ).toBeInTheDocument();
    closeOnly();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(agentNamed('Claude - Work')).toBeDefined();
  });

  it('delete refused by an open run shows the API reason and only Close (BR-30)', async () => {
    const { user } = await openAgents(() => scenarios.agents('deleteBlocked'));
    await openMenu(user, 'Codex');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete agent' }));
    expect(await screen.findByText('This agent has open runs')).toBeInTheDocument();
    expect(screen.getByText(RUN_REFUSAL)).toBeInTheDocument();
    closeOnly();
    expect(agentNamed('Codex')).toBeDefined();
  });

  it('the API refusing the default agent (another tab moved it): its text shows with only Close (BR-28)', async () => {
    const { user } = await openAgents();
    scenarios.problem('agents.remove', {
      status: 409,
      title: 'Conflict',
      detail: 'Set another agent as default first',
      type: 'conflict',
    });
    await openMenu(user, 'Codex');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete agent' }));
    expect(await screen.findByText('Set another agent as default first')).toBeInTheDocument();
    closeOnly();
    expect(agentNamed('Codex')).toBeDefined();
  });

  it('the only agent cannot be deleted: the BR-66 text shows with only Close and the agent stays', async () => {
    const { user } = await openAgents();
    scenarios.problem('agents.remove', {
      status: 409,
      title: 'Conflict',
      detail: 'A project needs at least one agent. Add another agent first.',
      type: 'conflict',
    });
    await openMenu(user, 'Codex');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete agent' }));
    expect(await screen.findByText('A project needs at least one agent. Add another agent first.')).toBeInTheDocument();
    closeOnly();
    expect(agentNamed('Codex')).toBeDefined();
  });

  it('an unknown 409 still shows the API text with only Close', async () => {
    const { user } = await openAgents();
    scenarios.problem('agents.remove', {
      status: 409,
      title: 'Conflict',
      detail: 'A rule or run still uses this agent. Try again once it is free.',
      type: 'conflict',
    });
    await openMenu(user, 'Codex');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete agent' }));
    expect(
      await screen.findByText('A rule or run still uses this agent. Try again once it is free.'),
    ).toBeInTheDocument();
    closeOnly();
  });

  it('a failed delete with a server error shows the title and keeps both buttons', async () => {
    const { user } = await openAgents();
    scenarios.serverError('agents.remove');
    await openMenu(user, 'Codex');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete agent' }));
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep agent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete agent' })).toBeInTheDocument();
  });

  it('create worked and the credential failed: the pane switches to Edit agent with the banner, and the retry creates nothing twice', async () => {
    const sent = captureWrites();
    const { user, router } = await openAgents();
    scenarios.problem('agents.putCredential', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/value', detail: 'The token was rejected by Anthropic.' }],
    });
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'Claude Code' }));
    await user.type(screen.getByLabelText('Name'), 'Claude - Half');
    await user.type(screen.getByLabelText('Subscription token'), 'bad-token-0123456789');
    await user.type(screen.getByLabelText('Model name'), 'opus');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));

    expect(await paneHeading('Edit agent')).toBeInTheDocument();
    expect(
      screen.getByText('Agent saved, credential not saved: The token was rejected by Anthropic.'),
    ).toBeInTheDocument();
    const created = agentNamed('Claude - Half');
    expect(router.state.location.search).toMatchObject({ agent: created.id });
    expect(screen.getByLabelText('Name')).toHaveValue('Claude - Half');

    server.resetHandlers();
    await user.type(screen.getByLabelText('Subscription token'), secret);
    await user.click(screen.getByRole('button', { name: 'Save and test' }));
    await waitFor(() => expect(agentNamed('Claude - Half').credential.set).toBe(true));
    await waitFor(() => expect(sent.filter((s) => s.method === 'PUT').length).toBe(2));
    expect(sent.filter((s) => s.method === 'POST' && s.path === `/api/projects/${projectId}/agents`)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText(/^Agent saved, credential not saved/)).toBeNull());
  });

  const partialProblem: Parameters<typeof scenarios.problem>[1] = {
    status: 400,
    title: 'Validation failed',
    type: 'validation',
    errors: [{ pointer: '/value', detail: 'The token was rejected by Anthropic.' }],
  };

  it('create worked and the credential failed: the Edit pane keeps the address, the auth type and the default tick, and the retry sets the default', async () => {
    const sent = captureWrites();
    const { user } = await openAgents();
    scenarios.problem('agents.putCredential', partialProblem);
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'Claude Code' }));
    await user.type(screen.getByLabelText('Name'), 'Claude - Draft');
    await user.click(screen.getByRole('radio', { name: 'API key' }));
    await user.type(screen.getByLabelText('API address'), 'https://llm.example.com');
    await user.type(screen.getByLabelText('API key'), 'bad-key-0123456789');
    await user.click(screen.getByRole('checkbox', { name: 'Use as the project default' }));
    await user.click(screen.getByRole('button', { name: 'Save agent' }));

    expect(await paneHeading('Edit agent')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'API key' })).toBeChecked();
    expect(screen.getByLabelText('API address')).toHaveValue('https://llm.example.com');
    expect(screen.getByRole('checkbox', { name: 'Use as the project default' })).toBeChecked();
    expect(agentNamed('Claude - Draft').isDefault).toBe(false);

    server.resetHandlers();
    await user.type(screen.getByLabelText('API key'), secret);
    await user.click(screen.getByRole('button', { name: 'Save and test' }));
    await waitFor(() => expect(agentNamed('Claude - Draft').credential.set).toBe(true));
    await waitFor(() => expect(agentNamed('Claude - Draft').isDefault).toBe(true));
    expect(sent.filter((x) => x.path.endsWith('/default'))).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'Use as the project default' })).toBeChecked();
  });

  it('a create that fails (name taken) keeps the provider, auth type, address and default tick in the Add pane (BR-9)', async () => {
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'Claude Code' }));
    await user.type(screen.getByLabelText('Name'), 'codex');
    await user.click(screen.getByRole('radio', { name: 'API key' }));
    await user.type(screen.getByLabelText('API address'), 'https://llm.example.com');
    await user.type(screen.getByLabelText('API key'), secret);
    await user.type(screen.getByLabelText('Model name'), 'my-model');
    await user.click(screen.getByRole('checkbox', { name: 'Use as the project default' }));
    await user.click(screen.getByRole('button', { name: 'Save agent' }));

    expect(await screen.findByText('Another agent in this project has this name.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'API key' })).toBeChecked();
    expect(screen.getByLabelText('API address')).toHaveValue('https://llm.example.com');
    expect(screen.getByLabelText('Model name')).toHaveValue('my-model');
    expect(screen.getByRole('checkbox', { name: 'Use as the project default' })).toBeChecked();
  });

  it('a 256-character name is accepted; 257 shows the field error and sends nothing (BR-8)', async () => {
    const sent = captureWrites();
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'OpenCode' }));
    typeInto('Name', 'n'.repeat(257));
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Use 256 characters or fewer.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(sent).toEqual([]);
    typeInto('Name', 'n'.repeat(256));
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Agent saved')).toBeInTheDocument();
  });

  it('a duplicate name maps to the name field and keeps what was typed (BR-9)', async () => {
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await user.click(await screen.findByRole('radio', { name: 'OpenCode' }));
    await user.type(screen.getByLabelText('Name'), 'codex');
    await user.type(screen.getByLabelText('Account label'), 'Mine');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText('Another agent in this project has this name.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Account label')).toHaveValue('Mine');
  });

  it('Escape closes the pane; focus returns to the opener', async () => {
    const { user } = await openAgents();
    const edit = screen.getByRole('button', { name: 'Edit Codex' });
    await user.click(edit);
    await paneHeading('Edit agent');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: 'Edit agent' })).toBeNull());
    await waitFor(() => expect(edit).toHaveFocus());
  });

  it('a reader without agent:update sees the read-only pane and no write controls', async () => {
    const access = tenantAccessFixtures.admin;
    const [assignment] = access.assignments;
    if (!assignment) throw new Error('no assignment');
    server.use(
      routeHandler('me.access', async () =>
        Response.json({
          ...access,
          assignments: [
            {
              ...assignment,
              permissions: assignment.permissions.filter(
                (l) => l.permission !== 'agent:update' && l.permission !== 'secret:update',
              ),
            },
          ],
        }),
      ),
    );
    const { user } = await openAgents();
    expect(screen.queryByRole('button', { name: 'Add agent' })).toBeNull();
    await user.click(screen.getAllByRole('button', { name: 'View' })[0] as HTMLElement);
    await paneHeading('View agent');
    expect(screen.getByText('You can see this agent but not change it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save agent' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  });

  it('shows the agent, its credential line and its connection in the Edit pane', async () => {
    const { user } = await openAgents();
    await user.click(screen.getByRole('button', { name: 'Edit Claude - Personal' }));
    await paneHeading('Edit agent');
    expect(screen.getByText(/^Set .+ by kim-hale\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Claude - Personal');
  });

  describe('credential and model of one agent', () => {
    const personal = () => agentNamed('Claude - Personal');
    const openPersonal = async (extra?: () => void) => {
      const rendered = await openAgents(() => {
        scenarios.agents('perAgentModels');
        extra?.();
      });
      await rendered.user.click(screen.getByRole('button', { name: 'Edit Claude - Personal' }));
      await paneHeading('Edit agent');
      return rendered;
    };

    it('replacing the credential sends { type, value } and the secret is in no Query or mutation cache entry', async () => {
      const sent = captureWrites();
      const { user, queryClient } = await openPersonal();
      await user.click(screen.getByRole('button', { name: 'Replace' }));
      await user.click(screen.getByRole('radio', { name: 'API key' }));
      await user.type(screen.getByLabelText('API key'), secret);
      await user.click(screen.getByRole('button', { name: 'Save and test' }));

      await waitFor(() => expect(screen.queryByLabelText('API key')).toBeNull());
      await waitFor(() => expect(sent.length).toBe(2));
      await waitFor(() => expect(sent[0]?.body).toBeDefined());
      expect(sent[0]).toMatchObject({ method: 'PUT', body: { type: 'api_key', value: secret } });
      expect(sent[1]).toMatchObject({ method: 'POST' });
      expect(sent[1]?.path).toMatch(/\/test$/);
      expect(personal().credential).toMatchObject({ set: true, type: 'api_key', setBy: 'alice' });

      const queries = JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      );
      const mutations = JSON.stringify(
        queryClient
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      );
      expect(queries).not.toContain(secret);
      expect(mutations).not.toContain(secret);
      expect(document.body.textContent).not.toContain(secret);
    });

    it('a refused credential keeps the panel open with the message', async () => {
      const { user } = await openPersonal();
      scenarios.problem('agents.putCredential', {
        status: 400,
        title: 'Validation failed',
        type: 'validation',
        errors: [{ pointer: '/value', detail: 'The token was rejected by Anthropic.' }],
      });
      await user.click(screen.getByRole('button', { name: 'Replace' }));
      await user.type(screen.getByLabelText('Subscription token'), 'bad-token');
      await user.click(screen.getByRole('button', { name: 'Save and test' }));
      expect(await screen.findByText('The token was rejected by Anthropic.')).toBeInTheDocument();
      expect(screen.getByLabelText('Subscription token')).toHaveAttribute('aria-invalid', 'true');
    });

    it('the Default model picker shows the live list', async () => {
      await openPersonal();
      await waitFor(() => expect(modelOptions()).toContain('claude-sonnet-4-5'));
      expect(modelOptions().at(-1)).toBe('Other model…');
    });

    it('Save agent saves the typed model exactly and shows it after returning', async () => {
      const sent = captureWrites();
      const { user } = await openPersonal();
      await waitFor(() => expect(modelOptions()).toContain('claude-sonnet-4-5'));
      await user.selectOptions(modelSelect(), 'Other model…');
      await user.clear(screen.getByRole('textbox', { name: 'Model name' }));
      await user.type(screen.getByRole('textbox', { name: 'Model name' }), 'my-gw/model-x:1');
      await user.click(screen.getByRole('button', { name: 'Save agent' }));
      await waitFor(() => expect(personal().model).toBe('my-gw/model-x:1'));
      await waitFor(() => expect(sent[0]?.body).toBeDefined());
      expect(sent[0]?.body).toEqual({ model: 'my-gw/model-x:1' });
      await user.click(await screen.findByRole('button', { name: 'Edit Claude - Personal' }));
      expect(await screen.findByRole('textbox', { name: 'Model name' })).toHaveValue('my-gw/model-x:1');
    });

    it('a saved model not in the live list shows under Other model… and Save agent keeps it', async () => {
      const sent = captureWrites();
      const { user } = await openAgents();
      await user.click(screen.getByRole('button', { name: 'Edit Claude - Work' }));
      await paneHeading('Edit agent');
      await waitFor(() => expect(modelOptions()).toContain('claude-sonnet-4-5-20250929'));
      expect(modelSelect()).toHaveDisplayValue('Other model…');
      expect(screen.getByRole('textbox', { name: 'Model name' })).toHaveValue('opus');
      await user.click(screen.getByRole('button', { name: 'Save agent' }));
      expect(await screen.findByText('Agent saved')).toBeInTheDocument();
      expect(sent.filter((s) => s.method === 'PATCH')).toEqual([]);
      expect(agentNamed('Claude - Work').model).toBe('opus');
    });

    it('an address change plus token saves both and the model list reloads without a page reload', async () => {
      const address = 'https://gw.example.com/anthropic';
      const sent = captureWrites();
      const { user } = await openAgents(() => {
        scenarios.agents('perAgentModels');
        scenarios.agentModels(agentNamed('Claude - Personal').id, {
          kind: 'live',
          ids: ['claude-default-1'],
          idsByBaseUrl: { [address]: ['gw-model-1', 'gw-model-2'] },
        });
      });
      await user.click(screen.getByRole('button', { name: 'Edit Claude - Personal' }));
      await paneHeading('Edit agent');
      await waitFor(() => expect(modelOptions()).toContain('claude-default-1'));
      await user.type(screen.getByLabelText('API address'), address);
      await user.type(screen.getByLabelText('Subscription token'), 'gw-token-0123456789');
      await user.click(screen.getByRole('button', { name: 'Save and test' }));
      await waitFor(() => expect(modelOptions()).toContain('gw-model-2'));
      expect(modelOptions()).not.toContain('claude-default-1');
      await waitFor(() => expect(sent[0]?.body).toBeDefined());
      expect(sent[0]?.body).toEqual({ type: 'oauth_token', value: 'gw-token-0123456789', baseUrl: address });
      expect(personal().baseUrl).toBe(address);
    });

    it('a /baseUrl problem shows on the API address field and the agent is refetched', async () => {
      const { user } = await openPersonal();
      scenarios.problem('agents.putCredential', {
        status: 400,
        title: 'Validation failed',
        type: 'validation',
        errors: [{ pointer: '/baseUrl', detail: 'Use a public https address.' }],
      });
      const listBefore = mockDb.requests('GET', `/api/projects/${projectId}/agents`);
      await user.type(screen.getByLabelText('API address'), 'https://10.0.0.1');
      await user.type(screen.getByLabelText('Subscription token'), 'gw-token-0123456789');
      await user.click(screen.getByRole('button', { name: 'Save and test' }));
      expect(await screen.findByText('Use a public https address.')).toBeInTheDocument();
      expect(screen.getByLabelText('API address')).toHaveAttribute('aria-invalid', 'true');
      await waitFor(() =>
        expect(mockDb.requests('GET', `/api/projects/${projectId}/agents`)).toBeGreaterThan(listBefore),
      );
    });

    it('a /model problem shows on the Default model field', async () => {
      const { user } = await openPersonal();
      scenarios.problem('agents.update', {
        status: 400,
        title: 'Validation failed',
        type: 'validation',
        errors: [{ pointer: '/model', detail: 'Use 1 to 200 letters, digits or . _ : / @ [ ] + -.' }],
      });
      await waitFor(() => expect(modelOptions()).toContain('claude-sonnet-4-5'));
      await user.selectOptions(modelSelect(), 'claude-sonnet-4-5');
      await user.click(screen.getByRole('button', { name: 'Save agent' }));
      expect(await screen.findByText(/^Use 1 to 200 letters, digits/)).toBeInTheDocument();
    });

    it('the models request failing shows the error state and Other model… still works', async () => {
      const sent = captureWrites();
      const { user } = await openAgents(() => {
        scenarios.agents('perAgentModels');
        scenarios.agentModels(agentNamed('Claude - Personal').id, { kind: 'error' });
      });
      await user.click(screen.getByRole('button', { name: 'Edit Claude - Personal' }));
      await paneHeading('Edit agent');
      expect(
        await screen.findByText('The model list could not be loaded. You can still type a model name.'),
      ).toBeInTheDocument();
      const input = screen.getByRole('textbox', { name: 'Model name' });
      await user.clear(input);
      await user.type(input, 'typed-model');
      await user.click(screen.getByRole('button', { name: 'Save agent' }));
      await waitFor(() => expect(sent[0]?.body).toBeDefined());
      expect(sent[0]?.body).toEqual({ model: 'typed-model' });
    });

    it('Save agent is disabled while a credential replace is pending', async () => {
      const { user } = await openPersonal();
      server.use(
        http.put('*/api/agents/:agentId/credential', async () => {
          await sleep(300);
          return HttpResponse.json({ updatedAt: new Date().toISOString() });
        }),
      );
      await user.click(screen.getByRole('button', { name: 'Replace' }));
      await user.type(screen.getByLabelText('Subscription token'), 'gw-token-0123456789');
      await user.click(screen.getByRole('button', { name: 'Save and test' }));
      expect(screen.getByRole('button', { name: 'Save agent' })).toBeDisabled();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save agent' })).toBeEnabled());
    });
  });
});
