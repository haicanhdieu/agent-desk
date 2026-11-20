import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { defaultTriggerState, mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

const projectId = ids.project.invoicerApi;
const agentPage = `/o/alice/p/${projectId}/desk/agent`;
const projectPath = `/api/projects/${projectId}`;
const agentPath = `${projectPath}/agent`;
const credentialPath = `/api/agents/${ids.agent.invoicerApi}/credential`;

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
const agentRow = () => {
  const row = mockDb.state.agents.find((a) => a.projectId === projectId);
  if (!row) throw new Error('agent not in the mock store');
  return row;
};

async function openPage() {
  const rendered = await renderRoute(agentPage);
  expect(await screen.findByRole('heading', { level: 1, name: 'Agent & settings' })).toBeInTheDocument();
  return rendered;
}

const field = (label: string) => screen.getByLabelText(label);
const unitSelect = () => screen.getByLabelText('Run time limit unit');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('desk agent route', () => {
  it('shows the agent, credential, limits and connection from the API', async () => {
    await openPage();
    expect(field('Run time limit')).toHaveValue('30');
    expect(unitSelect()).toHaveValue('minutes');
    expect(field('Concurrent runs')).toHaveValue('2');
    expect(field('Runs per ticket')).toHaveValue('10');
    expect(screen.getByText(/^Set .+ by kim-hale\./)).toBeInTheDocument();
    expect(screen.getByText('harbor-labs/invoicer-api', { selector: '.mono' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Webhook' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a 500 on agents.get shows the error banner with Retry', async () => {
    await renderRoute(agentPage, { scenario: () => scenarios.serverError('agents.get') });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows a 24 h limit as 24 hours', async () => {
    agentRow().timeoutSeconds = 86400;
    await openPage();
    expect(field('Run time limit')).toHaveValue('24');
    expect(unitSelect()).toHaveValue('hours');
  });

  it('shows a 7 day limit as 7 days', async () => {
    agentRow().timeoutSeconds = 604800;
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
    expect(sent).toEqual([{ method: 'PUT', path: agentPath, body: { model: 'opus', timeoutSeconds: 172800 } }]);
    expect(agentRow().timeoutSeconds).toBe(172800);

    sent.length = 0;
    await user.selectOptions(unitSelect(), 'hours');
    await user.clear(timeout);
    await user.type(timeout, '30');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    await waitFor(() => expect(agentRow().timeoutSeconds).toBe(108000));
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
    expect(sent.filter((s) => s.method === 'PUT' && s.path === agentPath)).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({ timeoutSeconds: 691200 });
    expect(agentRow().timeoutSeconds).toBe(1800);
  });

  it('shows the keep times from the agent: 7 days and 24 hours', async () => {
    await openPage();
    expect(field('Keep a paused run for')).toHaveValue('7');
    expect(screen.getByLabelText('Keep a paused run for unit')).toHaveValue('days');
    expect(field("Keep a finished run's session for")).toHaveValue('24');
    expect(screen.getByLabelText("Keep a finished run's session for unit")).toHaveValue('hours');
    expect(screen.getByText('After this, a paused run expires and its saved session is deleted.')).toBeInTheDocument();
    expect(screen.getByText('How long a finished run can be re-opened. 0 turns this off.')).toBeInTheDocument();
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
    expect(sent).toEqual([
      { method: 'PUT', path: agentPath, body: { model: 'opus', timeoutSeconds: 1800, pausedKeepSeconds: 259200 } },
    ]);
    expect(agentRow().pausedKeepSeconds).toBe(259200);
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
    expect(sent).toEqual([
      { method: 'PUT', path: agentPath, body: { model: 'opus', timeoutSeconds: 1800, idleEndSeconds: 5400 } },
    ]);
    expect(agentRow().idleEndSeconds).toBe(5400);
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
    expect(agentRow().idleEndSeconds).toBe(1800);
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
    expect(sent).toEqual([
      { method: 'PUT', path: agentPath, body: { model: 'opus', timeoutSeconds: 1800, autoResumeMax: 2 } },
    ]);
    expect(agentRow().autoResumeMax).toBe(2);
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
    expect(agentRow().autoResumeMax).toBe(5);
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
    expect(sent).toEqual([
      { method: 'PUT', path: agentPath, body: { model: 'opus', timeoutSeconds: 1800, doneKeepSeconds: 0 } },
    ]);
    expect(agentRow().doneKeepSeconds).toBe(0);
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
    expect(agentRow().pausedKeepSeconds).toBe(604800);
  });

  it('saving limits sends only the changed fields, and the agent body comes from the freshly fetched agent', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    // Someone changes the model and the runs-per-ticket limit after the page loaded.
    agentRow().model = 'sonnet';
    projectRow().maxRunsPerTicket = 20;
    const concurrent = field('Concurrent runs');
    await user.clear(concurrent);
    await user.type(concurrent, '3');
    const timeout = field('Run time limit');
    await user.clear(timeout);
    await user.type(timeout, '45');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));

    await waitFor(() => expect(sent).toHaveLength(2));
    await waitFor(() => expect(sent.every((s) => s.body !== undefined)).toBe(true));
    expect(sent.find((s) => s.method === 'PATCH')).toEqual({
      method: 'PATCH',
      path: projectPath,
      body: { maxConcurrentRuns: 3 },
    });
    expect(sent.find((s) => s.method === 'PUT')).toEqual({
      method: 'PUT',
      path: agentPath,
      body: { model: 'sonnet', timeoutSeconds: 2700 },
    });
    await waitFor(() => expect(agentRow().timeoutSeconds).toBe(2700));
    expect(projectRow()).toMatchObject({ maxConcurrentRuns: 3, maxRunsPerTicket: 20 });
    expect(await screen.findByText('Limits saved')).toBeInTheDocument();
  });

  it('nothing changed: Save limits sends nothing and shows no toast', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    await sleep(50);
    expect(sent).toHaveLength(0);
    expect(screen.queryByText('Limits saved')).toBeNull();
  });

  it('one limit request fails, the other saves; the retry resends only the failed field', async () => {
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
    expect(projectRow().maxConcurrentRuns).toBe(3);
    expect(screen.queryByText('Limits saved')).toBeNull();

    sent.length = 0;
    await user.selectOptions(unitSelect(), 'minutes');
    await user.clear(timeout);
    await user.type(timeout, '45');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Limits saved')).toBeInTheDocument();
    await waitFor(() => expect(sent.every((x) => x.body !== undefined)).toBe(true));
    expect(sent).toEqual([{ method: 'PUT', path: agentPath, body: { model: 'opus', timeoutSeconds: 2700 } }]);
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
    const { user } = await openPage();
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
    const { user } = await openPage();
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
    const { user } = await openPage();
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

  it('replacing the credential sends { type, value } and the secret is in no Query or mutation cache entry', async () => {
    const secret = 'sk-ant-oat01-replace-me-0123456789';
    const sent = captureWrites();
    const { user, queryClient } = await openPage();
    const agentBefore = mockDb.requests('GET', agentPath);
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await user.click(screen.getByRole('radio', { name: 'API key' }));
    await user.type(screen.getByLabelText('New token'), secret);
    await user.click(screen.getByRole('button', { name: 'Test and replace' }));

    await waitFor(() => expect(screen.queryByLabelText('New token')).toBeNull());
    await waitFor(() => expect(sent[0]?.body).toBeDefined());
    expect(sent).toEqual([{ method: 'PUT', path: credentialPath, body: { type: 'api_key', value: secret } }]);
    await waitFor(() => expect(mockDb.requests('GET', agentPath)).toBeGreaterThan(agentBefore));
    expect(agentRow().credential).toMatchObject({ set: true, type: 'api_key', setBy: 'alice' });

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
    const { user } = await openPage();
    scenarios.problem('agents.putCredential', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/value', detail: 'The token was rejected by Anthropic.' }],
    });
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await user.type(screen.getByLabelText('New token'), 'bad-token');
    await user.click(screen.getByRole('button', { name: 'Test and replace' }));
    expect(await screen.findByText('The token was rejected by Anthropic.')).toBeInTheDocument();
    expect(screen.getByLabelText('New token')).toHaveAttribute('aria-invalid', 'true');
  });

  it('delete asks to confirm, removes the project and goes to the projects list', async () => {
    const { user, router } = await openPage();
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
    await openPage();
    expect(screen.getByText('3 hours ago (polling)')).toBeInTheDocument();
    const button = checkNow();
    fireEvent.click(button);
    fireEvent.click(button);
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
      await openPage();
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
    const { user } = await openPage();
    await user.click(checkNow());
    expect(await screen.findByRole('alert')).toHaveTextContent('Polling is paused: token_revoked');
    expect(screen.getByText('3 hours ago (polling)')).toBeInTheDocument();
    expect(checkNow()).toBeEnabled();
  });

  it('a server error shows a message and the button is usable again', async () => {
    pollingProject();
    const { user } = await openPage();
    scenarios.serverError('projects.pollNow');
    await user.click(checkNow());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start the check');
    expect(checkNow()).toBeEnabled();
  });
});

describe('desk agent route: default model and API address', () => {
  const agentId = ids.agent.invoicerApi;
  const modelSelect = () => screen.getByRole('combobox', { name: 'Default model' });
  const modelOptions = () => Array.from(modelSelect().querySelectorAll('option')).map((o) => o.textContent);

  it('the Default model picker shows the live list', async () => {
    await openPage();
    await waitFor(() => expect(modelOptions()).toContain('claude-sonnet-4-5-20250929'));
    expect(modelOptions().at(-1)).toBe('Other model…');
  });

  it('Save agent saves the typed model exactly and shows it after returning', async () => {
    const sent = captureWrites();
    const { user, router } = await openPage();
    await waitFor(() => expect(modelOptions()).toContain('claude-sonnet-4-5-20250929'));
    await user.selectOptions(modelSelect(), 'Other model…');
    await user.clear(screen.getByRole('textbox', { name: 'Model name' }));
    await user.type(screen.getByRole('textbox', { name: 'Model name' }), 'my-gw/model-x:1');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    await waitFor(() => expect(agentRow().model).toBe('my-gw/model-x:1'));
    expect(sent.find((s) => s.path === agentPath)?.body).toMatchObject({ model: 'my-gw/model-x:1' });

    await act(async () => {
      await router.navigate({ to: `/o/alice/p/${projectId}/desk/rules` });
    });
    await act(async () => {
      await router.navigate({ to: agentPage });
    });
    expect(await screen.findByRole('textbox', { name: 'Model name' })).toHaveValue('my-gw/model-x:1');
  });

  it('a saved model not in the live list shows under Other model… and Save agent keeps it', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    await waitFor(() => expect(modelOptions()).toContain('claude-sonnet-4-5-20250929'));
    expect(modelSelect()).toHaveDisplayValue('Other model…');
    expect(screen.getByRole('textbox', { name: 'Model name' })).toHaveValue('opus');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    await waitFor(() => expect(sent.find((s) => s.path === agentPath)?.body).toMatchObject({ model: 'opus' }));
    expect(agentRow().model).toBe('opus');
  });

  it('an address change plus token saves both and the model list reloads without a page reload', async () => {
    const address = 'https://gw.example.com/anthropic';
    scenarios.agentModels(agentId, {
      kind: 'live',
      ids: ['claude-default-1'],
      idsByBaseUrl: { [address]: ['gw-model-1', 'gw-model-2'] },
    });
    const sent = captureWrites();
    const { user } = await openPage();
    await waitFor(() => expect(modelOptions()).toContain('claude-default-1'));
    await user.type(field('API address'), address);
    await user.type(screen.getByLabelText('New token'), 'gw-token-0123456789');
    await user.click(screen.getByRole('button', { name: 'Test and replace' }));
    await waitFor(() => expect(modelOptions()).toContain('gw-model-2'));
    expect(modelOptions()).not.toContain('claude-default-1');
    expect(sent.find((s) => s.path === credentialPath)?.body).toEqual({
      type: 'oauth_token',
      value: 'gw-token-0123456789',
      baseUrl: address,
    });
    expect(agentRow().baseUrl).toBe(address);
  });

  it('a /baseUrl problem shows on the API address field and the agent is refetched', async () => {
    const { user } = await openPage();
    scenarios.problem('agents.putCredential', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/baseUrl', detail: 'Use a public https address.' }],
    });
    const agentBefore = mockDb.requests('GET', agentPath);
    await user.type(field('API address'), 'https://10.0.0.1');
    await user.type(screen.getByLabelText('New token'), 'gw-token-0123456789');
    await user.click(screen.getByRole('button', { name: 'Test and replace' }));
    expect(await screen.findByText('Use a public https address.')).toBeInTheDocument();
    expect(field('API address')).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(mockDb.requests('GET', agentPath)).toBeGreaterThan(agentBefore));
  });

  it('a /model problem shows on the Default model field', async () => {
    const { user } = await openPage();
    scenarios.problem('agents.put', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/model', detail: 'Use 1 to 200 letters, digits or . _ : / @ [ ] + -.' }],
    });
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByText(/^Use 1 to 200 letters, digits/)).toBeInTheDocument();
  });

  it('the models request failing shows the error state and Other model… still works', async () => {
    scenarios.agentModels(agentId, { kind: 'error' });
    const sent = captureWrites();
    const { user } = await openPage();
    expect(
      await screen.findByText('The model list could not be loaded. You can still type a model name.'),
    ).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Model name' });
    await user.clear(input);
    await user.type(input, 'typed-model');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    await waitFor(() => expect(sent.find((s) => s.path === agentPath)?.body).toMatchObject({ model: 'typed-model' }));
  });

  it('Save agent is disabled while a credential replace is pending', async () => {
    const { user } = await openPage();
    server.use(
      http.put('*/api/agents/:agentId/credential', async () => {
        await sleep(300);
        return HttpResponse.json({ updatedAt: new Date().toISOString() });
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await user.type(screen.getByLabelText('New token'), 'gw-token-0123456789');
    await user.click(screen.getByRole('button', { name: 'Test and replace' }));
    expect(screen.getByRole('button', { name: 'Save agent' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save agent' })).toBeEnabled());
  });
});
