import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
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

describe('desk agent route', () => {
  it('shows the agent, credential, limits and connection from the API', async () => {
    await openPage();
    expect(field('Run time limit')).toHaveValue('30');
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

  it('a timeout of 60 min is refused: the /timeoutSeconds message shows on Run time limit and the form stays filled', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    const timeout = field('Run time limit');
    await user.clear(timeout);
    await user.type(timeout, '60');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));

    await waitFor(() => expect(timeout).toHaveAttribute('aria-invalid', 'true'));
    const describedBy = timeout.getAttribute('aria-describedby') ?? '';
    const messages = describedBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(messages).toMatch(/3300/);
    expect(timeout).toHaveValue('60');
    expect(sent.filter((s) => s.method === 'PUT' && s.path === agentPath)).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({ timeoutSeconds: 3600 });
    expect(agentRow().timeoutSeconds).toBe(1800);
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

  it('nothing changed: Save limits sends nothing', async () => {
    const sent = captureWrites();
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Limits saved')).toBeInTheDocument();
    expect(sent).toHaveLength(0);
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

  it('a failed trigger mode change goes back to the saved mode and shows the error', async () => {
    const { user } = await openPage();
    scenarios.serverError('projects.update');
    await user.click(screen.getByRole('radio', { name: 'Polling' }));
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Webhook' })).toHaveAttribute('aria-checked', 'true'));
    expect(projectRow().triggerMode).toBe('webhook');
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
