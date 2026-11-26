import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { applyProjectSpace, type ProjectSpaceRole } from '@/mocks/msw/projectSpaceScenarios';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

const projectId = ids.project.invoicerApi;
const agentPage = `/o/alice/p/${projectId}/desk/agent`;

let stopLog: (() => void) | undefined;
afterEach(() => {
  stopLog?.();
  stopLog = undefined;
});

/** The GET paths the app requests, in order. */
function logGets() {
  const gets: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method === 'GET') gets.push(new URL(request.url).pathname);
  };
  server.events.on('request:start', listener);
  stopLog = () => server.events.removeListener('request:start', listener);
  return gets;
}
const agentListGets = (gets: string[]) => gets.filter((p) => p === `/api/projects/${projectId}/agents`);

const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);
const search = (router: { state: { location: { search: unknown } } }) =>
  router.state.location.search as Record<string, unknown>;
const selected = () => screen.getByRole('tab', { selected: true }).textContent;

async function open(path = agentPage, scenario?: () => void) {
  const rendered = await renderRoute(path, scenario ? { scenario } : {});
  expect(await screen.findByRole('heading', { level: 1, name: 'Agent & settings' })).toBeInTheDocument();
  return rendered;
}

describe('Agent & settings tabs (BR-55, BR-56)', () => {
  it('TC-55.1: opens on Agents with the four tabs in order and only the Agents panel', async () => {
    await open();
    expect(screen.getByRole('tablist', { name: 'Agent and project settings' })).toBeInTheDocument();
    expect(tabNames()).toEqual(['Agents', 'GitHub connection', 'Limits', 'Danger zone']);
    expect(selected()).toBe('Agents');
    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Run time limit')).not.toBeInTheDocument();
  });

  it('TC-55.2, TC-56.1: each tab shows its own panel and the URL carries tab, none for Agents', async () => {
    const { router, user } = await open();
    await user.click(screen.getByRole('tab', { name: 'GitHub connection' }));
    expect(screen.getByRole('radio', { name: 'Webhook' })).toBeInTheDocument();
    expect(search(router).tab).toBe('github');
    await user.click(screen.getByRole('tab', { name: 'Limits' }));
    expect(screen.getByLabelText('Run time limit')).toBeInTheDocument();
    expect(search(router).tab).toBe('limits');
    await user.click(screen.getByRole('tab', { name: 'Danger zone' }));
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeInTheDocument();
    expect(search(router).tab).toBe('danger');
    await user.click(screen.getByRole('tab', { name: 'Agents' }));
    expect(search(router).tab).toBeUndefined();
    expect(router.state.location.href).toBe(agentPage);
  });

  it.each([
    ['github', 'GitHub connection'],
    ['limits', 'Limits'],
    ['danger', 'Danger zone'],
  ])('TC-56.3: ?tab=%s opens %s', async (value, name) => {
    await open(`${agentPage}?tab=${value}`);
    expect(selected()).toBe(name);
  });

  it('TC-56.2: Back restores the tab before', async () => {
    const { router, user } = await open();
    await user.click(screen.getByRole('tab', { name: 'Limits' }));
    expect(selected()).toBe('Limits');
    router.history.back();
    await waitFor(() => expect(selected()).toBe('Agents'));
    expect(search(router).tab).toBeUndefined();
  });

  it('TC-56.4: arrow keys, End and Home move the selection and keep focus on the tab', async () => {
    await open();
    const first = screen.getByRole('tab', { name: 'Agents' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    await waitFor(() => expect(selected()).toBe('GitHub connection'));
    expect(screen.getByRole('tab', { name: 'GitHub connection' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'GitHub connection' }), { key: 'End' });
    await waitFor(() => expect(selected()).toBe('Danger zone'));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Danger zone' }), { key: 'ArrowLeft' });
    await waitFor(() => expect(selected()).toBe('Limits'));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Limits' }), { key: 'Home' });
    await waitFor(() => expect(selected()).toBe('Agents'));
    expect(screen.getByRole('tab', { name: 'Agents' })).toHaveFocus();
  });
});

describe('Agent & settings tabs, fallbacks (BR-57)', () => {
  it('TC-57.1: an unknown tab shows Agents', async () => {
    await open(`${agentPage}?tab=nonsense`);
    expect(selected()).toBe('Agents');
    expect(tabNames()).toHaveLength(4);
  });

  it('TC-57.2: a project admin sees three tabs, and ?tab=danger shows Agents', async () => {
    const role: ProjectSpaceRole = 'projectAdmin';
    await open(`${agentPage}?tab=danger`, () => applyProjectSpace(mockDb, { role }));
    expect(tabNames()).toEqual(['Agents', 'GitHub connection', 'Limits']);
    expect(selected()).toBe('Agents');
  });

  it('TC-57.3: an owner uses the project delete from the Danger zone tab', async () => {
    const { user } = await open(`${agentPage}?tab=danger`);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('Agent & settings tabs, state (BR-58)', () => {
  it('TC-58.2, TC-58.3: changing tab clears agent and page', async () => {
    const { router, user } = await open(`${agentPage}?agent=new&page=2`, () => scenarios.agents('manyAgents'));
    expect(search(router)).toMatchObject({ agent: 'new', page: '2' });
    await user.click(screen.getByRole('tab', { name: 'Limits' }));
    expect(search(router)).toEqual({ tab: 'limits' });
    await user.click(screen.getByRole('tab', { name: 'Agents' }));
    expect(router.state.location.href).toBe(agentPage);
  });

  it('a bad agent param falls back to closed', async () => {
    const { router } = await open(`${agentPage}?agent=nonsense`);
    expect(search(router).agent).toBeUndefined();
  });

  it('TC-58.4: an unsaved Limits edit is dropped on the way back', async () => {
    const { user } = await open(`${agentPage}?tab=limits`);
    const saved = (screen.getByLabelText('Concurrent runs') as HTMLInputElement).value;
    fireEvent.change(screen.getByLabelText('Concurrent runs'), { target: { value: '7' } });
    expect(screen.getByLabelText('Concurrent runs')).toHaveValue('7');
    await user.click(screen.getByRole('tab', { name: 'Agents' }));
    await user.click(screen.getByRole('tab', { name: 'Limits' }));
    expect(screen.getByLabelText('Concurrent runs')).toHaveValue(saved);
  });
});

describe('Agent & settings tabs, own data (BR-59)', () => {
  it('TC-59.1, TC-59.2: a 500 on the agent list shows its own error; the other tabs still load; Retry loads the list', async () => {
    const { user } = await open(agentPage, () => scenarios.agents('listError'));
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'GitHub connection' }));
    expect(screen.getByRole('radio', { name: 'Webhook' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Limits' }));
    expect(screen.getByLabelText('Run time limit')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Agents' }));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    server.resetHandlers();
    await user.click(retry);
    expect(await screen.findByText('Claude - Personal')).toBeInTheDocument();
  });

  it('the agent list is requested only while the Agents tab is open', async () => {
    const gets = logGets();
    const { user } = await open(`${agentPage}?tab=limits`);
    await user.click(screen.getByRole('tab', { name: 'GitHub connection' }));
    expect(agentListGets(gets)).toHaveLength(0);
    await user.click(screen.getByRole('tab', { name: 'Agents' }));
    await screen.findByText('Claude');
    expect(agentListGets(gets).length).toBeGreaterThan(0);
  });
});
