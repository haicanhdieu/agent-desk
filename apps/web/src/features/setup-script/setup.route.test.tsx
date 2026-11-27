import type { SetupTestDto } from '@agentdesk/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { setupScript } from '@/mocks/setup';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { SETUP_SCRIPT_STARTER } from '@/screens/DeskSetup';
import { FakeEventSource } from '@/test/fakeEventSource';
import { FakeWebSocket } from '@/test/fakeWebSocket';
import { renderRoute } from '@/test/renderRoute';

const projectId = ids.project.invoicerApi;
const emptyProjectId = ids.project.docsSite;
const base = (id = projectId) => `/o/alice/p/${id}/desk/setup`;
const scriptPath = (id = projectId) => `/api/projects/${id}/setup-script`;
const SHA = 'a91c3e2' + '0'.repeat(33);

/** Records the JSON bodies the app sends with `method` to paths ending in `suffix`. */
function capture(method: string, suffix: string) {
  const bodies: unknown[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method === method && new URL(request.url).pathname.endsWith(suffix)) {
      void request
        .clone()
        .json()
        .then((b: unknown) => bodies.push(b));
    }
  };
  server.events.on('request:start', listener);
  stops.push(() => server.events.removeListener('request:start', listener));
  return bodies;
}
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

const editor = () => screen.getByRole('textbox', { name: 'Setup script' });
const dbTest = (): SetupTestDto => {
  const t = mockDb.state.setupTests.at(-1);
  if (!t) throw new Error('no setup test in the mock store');
  return t;
};
/** The server moves the test on: the store row changes and the stream sends the new state. */
const serverSays = (patch: Partial<SetupTestDto>) => {
  Object.assign(dbTest(), patch);
  act(() => FakeEventSource.latest().emit('status', structuredClone(dbTest())));
};
const serverLogs = (seq: number, payload: Record<string, unknown>) =>
  act(() =>
    FakeEventSource.latest().emit('event', { seq, ts: new Date().toISOString(), type: 'lifecycle', payload }, seq),
  );

describe('desk setup route', () => {
  it('loads the saved script, the plugins and the version history', async () => {
    await renderRoute(base());
    expect(await screen.findByText(/Version 1, saved by kim-hale/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Workspace setup' })).toBeInTheDocument();
    expect(editor()).toHaveValue(setupScript);
    expect(screen.getByText(/Version 1, saved by kim-hale/)).toBeInTheDocument();
    expect(await screen.findByText('superpowers')).toBeInTheDocument();
    expect(screen.getByText('Blocked: store not approved')).toBeInTheDocument();
    const history = await screen.findByRole('list', { name: 'Setup script versions' });
    expect(within(history).getByText('Restore .NET tools before restore')).toBeInTheDocument();
    expect(screen.getByText('Not tested yet')).toBeInTheDocument();
  });

  describe('paged version history', () => {
    const nav = () => screen.getByRole('navigation', { name: 'Pagination' });
    const versionRows = () =>
      within(screen.getByRole('list', { name: 'Setup script versions' })).getAllByRole('listitem');
    function seedVersions(count: number) {
      mockDb.state.setupScripts[projectId] = Array.from({ length: count }, (_, i) => ({
        version: i + 1,
        body: `echo ${i + 1}`,
        note: `Change ${i + 1}`,
        createdBy: 'kim-hale',
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      }));
    }

    it('23 versions: the header reads "23 versions" with 20 rows; Page 2 shows 3 rows', async () => {
      seedVersions(23);
      const { user, router } = await renderRoute(base());
      await screen.findByRole('navigation', { name: 'Pagination' });
      expect(screen.getByText('23 versions')).toBeInTheDocument();
      expect(versionRows()).toHaveLength(20);
      await user.click(screen.getAllByRole('button', { name: 'Page 2' })[0] as HTMLElement);
      await waitFor(() => expect(versionRows()).toHaveLength(3));
      expect(router.state.location.search).toEqual({ page: '2' });
      expect(nav()).toHaveTextContent('Showing 21–23 of 23');
      expect(screen.getByText('23 versions')).toBeInTheDocument();
    });

    it('while page 2 is held, the control still reads "Showing 1–20" with Page 1 current; then the new range', async () => {
      seedVersions(23);
      const { user } = await renderRoute(base());
      await screen.findByRole('navigation', { name: 'Pagination' });
      const versionsApi = `${scriptPath()}/versions`;
      const page2Body = await (await fetch(`http://localhost:3000${versionsApi}?page=2&pageSize=20`)).json();
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(`*${versionsApi}`, async ({ request }) => {
          if (new URL(request.url).searchParams.get('page') !== '2') return undefined;
          await held;
          return HttpResponse.json(page2Body);
        }),
      );
      await user.click(screen.getAllByRole('button', { name: 'Page 2' })[0] as HTMLElement);
      await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'true'));
      expect(versionRows()).toHaveLength(20);
      expect(nav()).toHaveTextContent('Showing 1–20 of 23');
      expect(within(nav()).getAllByRole('button', { name: 'Page 1' })[0]).toHaveAttribute('aria-current', 'page');
      release();
      await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'false'));
      expect(nav()).toHaveTextContent('Showing 21–23 of 23');
      expect(within(nav()).getAllByRole('button', { name: 'Page 2' })[0]).toHaveAttribute('aria-current', 'page');
    });

    it('marks "current" only on the newest version: page 1 first row, never on page 2', async () => {
      seedVersions(23);
      const { user } = await renderRoute(base());
      await screen.findByRole('navigation', { name: 'Pagination' });
      expect(within(versionRows()[0] as HTMLElement).getByText(/· current/)).toBeInTheDocument();
      await user.click(screen.getAllByRole('button', { name: 'Page 2' })[0] as HTMLElement);
      await waitFor(() => expect(versionRows()).toHaveLength(3));
      expect(screen.queryByText(/· current/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Restore version 3' })).toBeInTheDocument();
    });

    it('?page=5 is replaced by ?page=2', async () => {
      seedVersions(23);
      const { router } = await renderRoute(`${base()}?page=5`);
      await waitFor(() => expect(router.state.location.search).toEqual({ page: '2' }));
      await waitFor(() => expect(versionRows()).toHaveLength(3));
    });

    it('a project with 0 versions shows no pagination control', async () => {
      await renderRoute(base(emptyProjectId));
      await screen.findByText('No versions yet. The first save creates version 1.');
      expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    });

    it('while loading and when failing there is no pagination control', async () => {
      seedVersions(23);
      scenarios.serverError('setupScript.versions', { delayMs: 150 });
      await renderRoute(base());
      await screen.findByRole('textbox', { name: 'Setup script' });
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
      expect(await screen.findByText('Could not load the version history. Reload to try again.')).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    });
  });

  it('the Project menu links to workspace setup', async () => {
    await renderRoute(base());
    const menu = await screen.findByRole('navigation', { name: 'Project menu' });
    expect(within(menu).getByRole('link', { name: /Workspace setup/ })).toHaveAttribute('href', base());
  });

  it('saves a new version with baseVersion and the note (v1 → v2)', async () => {
    const puts = capture('PUT', '/setup-script');
    const { user } = await renderRoute(base());
    await screen.findByText(/Version 1, saved by/);
    const save = screen.getByRole('button', { name: 'Save version 2' });
    expect(save).toBeDisabled();
    await user.type(editor(), '\ndotnet build');
    await user.type(screen.getByLabelText(/Change note/), 'Build once');
    await user.click(save);
    expect(await screen.findByText(/Version 2, saved by alice/)).toBeInTheDocument();
    expect(puts).toEqual([{ body: `${setupScript}\ndotnet build`, note: 'Build once', baseVersion: 1 }]);
    // The history refetched, and the next save is version 3 from version 2.
    const history = screen.getByRole('list', { name: 'Setup script versions' });
    expect(await within(history).findByText('Build once')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save version 3' })).toBeDisabled();
    expect(mockDb.state.setupScripts[projectId]?.map((v) => v.version)).toEqual([1, 2]);
  });

  it('409: keeps the draft, shows "Changed since you opened it", sends nothing more', async () => {
    const { user } = await renderRoute(base());
    await screen.findByText(/Version 1, saved by/);
    await user.type(editor(), '\nmy change');
    // Someone else saves version 2 meanwhile.
    mockDb.state.setupScripts[projectId]?.push({
      version: 2,
      body: 'echo theirs',
      note: null,
      createdBy: 'dana-ortiz',
      createdAt: new Date().toISOString(),
    });
    await user.click(screen.getByRole('button', { name: 'Save version 2' }));
    expect(await screen.findByText('Changed since you opened it. Reload to see the new version.')).toBeInTheDocument();
    expect(editor()).toHaveValue(`${setupScript}\nmy change`);
    expect(screen.getByRole('button', { name: 'Save version 2' })).toBeEnabled();
    // Trying again is refused again: the draft still starts from version 1.
    await user.click(screen.getByRole('button', { name: 'Save version 2' }));
    await waitFor(() => expect(mockDb.requests('PUT', scriptPath())).toBe(2));
    expect(mockDb.state.setupScripts[projectId]?.map((v) => v.version)).toEqual([1, 2]);
  });

  it('a project without a script: starter text, the empty copy, and the first save sends baseVersion null', async () => {
    const puts = capture('PUT', '/setup-script');
    const { user } = await renderRoute(base(emptyProjectId));
    expect(await screen.findByText('No setup script: runs start the agent right after cloning.')).toBeInTheDocument();
    expect(editor()).toHaveValue(SETUP_SCRIPT_STARTER);
    expect(await screen.findByText(/No versions yet/)).toBeInTheDocument();
    expect(await screen.findByText(/enables no plugins/)).toBeInTheDocument();
    await user.type(editor(), 'npm ci');
    await user.click(screen.getByRole('button', { name: 'Save version 1' }));
    expect(await screen.findByText(/Version 1, saved by alice/)).toBeInTheDocument();
    expect(puts).toEqual([{ body: `${SETUP_SCRIPT_STARTER}npm ci`, baseVersion: null }]);
  });

  describe('byte limit', () => {
    /** "é" is two bytes in UTF-8, so 32768 of them are exactly the 64 KiB limit. */
    const exactly = 'é'.repeat(32768);

    it('rejects 65537 bytes before sending, with the contract message', async () => {
      const puts = capture('PUT', '/setup-script');
      const { user } = await renderRoute(base());
      await screen.findByText(/Version 1, saved by/);
      fireEvent.change(editor(), { target: { value: `${exactly}a` } });
      await user.click(screen.getByRole('button', { name: 'Save version 2' }));
      expect(await screen.findByText('Setup script is larger than 64 KiB')).toBeInTheDocument();
      expect(mockDb.requests('PUT', scriptPath())).toBe(0);
      // Test setup refuses it too.
      await user.click(screen.getByRole('button', { name: 'Test setup' }));
      expect(mockDb.requests('POST', `/api/projects/${projectId}/setup-tests`)).toBe(0);
      expect(puts).toEqual([]);
    });

    it('accepts exactly 65536 bytes of multi-byte text', async () => {
      const puts = capture('PUT', '/setup-script');
      const { user } = await renderRoute(base());
      await screen.findByText(/Version 1, saved by/);
      fireEvent.change(editor(), { target: { value: exactly } });
      await user.click(screen.getByRole('button', { name: 'Save version 2' }));
      expect(await screen.findByText(/Version 2, saved by alice/)).toBeInTheDocument();
      expect(puts).toEqual([{ body: exactly, baseVersion: 1 }]);
      expect(screen.queryByText('Setup script is larger than 64 KiB')).not.toBeInTheDocument();
    });
  });

  describe('test workspace', () => {
    /** Opens the page and starts a test of the editor's text. */
    async function startTest() {
      const posts = capture('POST', '/setup-tests');
      const utils = await renderRoute(base());
      await screen.findByText(/Version 1, saved by/);
      await utils.user.click(screen.getByRole('button', { name: 'Test setup' }));
      await screen.findByText('Setting up');
      return { ...utils, posts };
    }

    it('Test sends the editor text, then the panel goes running → passed from the stream', async () => {
      const { posts } = await startTest();
      expect(posts).toEqual([{ script: setupScript }]);
      const id = dbTest().id;
      const source = FakeEventSource.latest();
      expect(source.url).toBe(`/api/setup-tests/${id}/events?orgId=${ids.org.alice}`);
      expect(screen.getByRole('list', { name: 'Setup phases' })).toHaveTextContent('Clone');
      // The sha-256 is real and the test matches the saved script.
      expect(dbTest().scriptSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(dbTest().matchesCurrentScript).toBe(true);

      serverSays({ status: 'running', checkoutSha: SHA });
      serverLogs(1, { kind: 'checkout', text: `agentdesk: checkout ${SHA}`, sha: SHA });
      serverLogs(2, { kind: 'setup_begin', text: 'agentdesk: setup begin' });
      serverLogs(3, { kind: 'setup_output', text: '+ dotnet restore\n', truncated: false });
      const phases = screen.getByRole('list', { name: 'Setup phases' });
      expect(within(phases).getByText('a91c3e2')).toBeInTheDocument();
      expect(screen.getByText('Setting up')).toBeInTheDocument();
      expect(screen.getByLabelText('Test workspace terminal')).toHaveTextContent('+ dotnet restore');
      expect(screen.getByText('Version 1')).toBeInTheDocument();

      serverLogs(4, { kind: 'setup_passed', text: 'agentdesk: setup passed' });
      // The backend records the result and deletes the workspace together: the test arrives finished and ended.
      const done = new Date().toISOString();
      serverSays({ status: 'passed', exitCode: null, finishedAt: done, endedAt: done });
      // The result stays on the page after the workspace is gone.
      expect(await screen.findByText('Last test passed, matches the saved script')).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Setup phases' })).not.toBeInTheDocument();
    });

    it('a failed setup is reported as failed once its workspace is gone, with the exit code in the log', async () => {
      const { user } = await startTest();
      serverLogs(1, { kind: 'checkout', text: 'x', sha: SHA });
      serverLogs(2, { kind: 'setup_failed', text: 'agentdesk: setup failed exit=1', exitCode: 1 });
      serverSays({ status: 'failed', exitCode: 1, checkoutSha: SHA, endedAt: new Date().toISOString() });
      expect(await screen.findByText('Last test failed')).toBeInTheDocument();
      await user.click(await screen.findByRole('button', { name: 'View log' }));
      expect(await screen.findByText('Setup failed')).toBeInTheDocument();
      expect(within(screen.getByRole('list', { name: 'Setup phases' })).getByText('exit 1')).toBeInTheDocument();
    });

    it('never opens a terminal: the workspace is deleted as soon as the result is recorded', async () => {
      await startTest();
      serverSays({ status: 'running' });
      serverSays({ status: 'passed', exitCode: null, endedAt: new Date().toISOString() });
      await screen.findByText('Last test passed, matches the saved script');
      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(screen.queryByRole('tab', { name: 'Terminal' })).not.toBeInTheDocument();
    });

    it('End test posts end for a test still in flight; the last-test banner then says it ended', async () => {
      const { user } = await startTest();
      const id = dbTest().id;
      serverSays({ status: 'running', checkoutSha: SHA });
      await user.click(await screen.findByRole('button', { name: 'End test' }));
      await waitFor(() => expect(mockDb.requests('POST', `/api/setup-tests/${id}/end`)).toBe(1));
      expect(await screen.findByText('Last test ended without a result')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'End test' })).not.toBeInTheDocument();
      expect(dbTest()).toMatchObject({ status: 'ended', endedAt: expect.any(String) });
    });

    it('saving a changed script makes the last test stale', async () => {
      const { user } = await startTest();
      serverSays({ status: 'passed', exitCode: null, checkoutSha: SHA, endedAt: new Date().toISOString() });
      await screen.findByText('Last test passed, matches the saved script');
      await user.type(editor(), '\necho more');
      await user.click(screen.getByRole('button', { name: 'Save version 2' }));
      expect(await screen.findByText('Last test passed, but the script changed since')).toBeInTheDocument();
    });

    it('View log opens an ended test as a log', async () => {
      const { user } = await startTest();
      serverLogs(1, { kind: 'setup_output', text: 'line from the test\n', truncated: false });
      serverSays({ status: 'passed', exitCode: null, checkoutSha: SHA, endedAt: new Date().toISOString() });
      await user.click(await screen.findByRole('button', { name: 'View log' }));
      expect(await screen.findByLabelText('Test workspace terminal')).toHaveTextContent('line from the test');
      // The log of a passed test shows as passed (the backend stores no exit code for a pass).
      expect(screen.getByText('Setup passed')).toBeInTheDocument();
    });
  });

  describe('version history', () => {
    const second = {
      version: 2,
      body: 'echo two',
      note: 'Second',
      createdBy: 'dana-ortiz',
      createdAt: new Date().toISOString(),
    };

    it('View puts that version in the editor as a draft', async () => {
      mockDb.state.setupScripts[projectId]?.push(second);
      const { user } = await renderRoute(base());
      await screen.findByText(/Version 2, saved by dana-ortiz/);
      await user.click(await screen.findByRole('button', { name: 'View version 1' }));
      await waitFor(() => expect(editor()).toHaveValue(setupScript));
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    it('Restore saves that version as a new one from the current version', async () => {
      const puts = capture('PUT', '/setup-script');
      mockDb.state.setupScripts[projectId]?.push(second);
      const { user } = await renderRoute(base());
      await screen.findByText(/Version 2, saved by dana-ortiz/);
      await user.click(await screen.findByRole('button', { name: 'Restore version 1' }));
      expect(await screen.findByText(/Version 3, saved by alice/)).toBeInTheDocument();
      expect(puts).toEqual([{ body: setupScript, note: 'Restored from version 1', baseVersion: 2 }]);
      expect(editor()).toHaveValue(setupScript);
    });
  });

  describe('loading and errors', () => {
    it('shows a loading state while the script loads, then the error when it fails', async () => {
      scenarios.serverError('setupScript.get', { delayMs: 30 });
      await renderRoute(base());
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(await screen.findByText('Could not load the setup script')).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'Setup script' })).not.toBeInTheDocument();
    });

    it('the version history failing shows why, the rest still works', async () => {
      scenarios.serverError('setupScript.versions');
      await renderRoute(base());
      expect(await screen.findByText(/Could not load the version history/)).toBeInTheDocument();
      expect(editor()).toHaveValue(setupScript);
    });

    it('the plugins failing shows why, the rest still works', async () => {
      scenarios.serverError('setup.plugins');
      await renderRoute(base());
      expect(await screen.findByText(/Could not load the plugins/)).toBeInTheDocument();
      expect(editor()).toHaveValue(setupScript);
    });

    it('unreadable repo settings show the plugins error line', async () => {
      const plugins = mockDb.state.plugins[projectId];
      if (plugins) plugins.settingsError = 'unreadable';
      await renderRoute(base());
      expect(await screen.findByText(/Could not read \.claude\/settings\.json/)).toBeInTheDocument();
    });

    it('a failing test start shows the problem and keeps the editor', async () => {
      const { user } = await renderRoute(base());
      await screen.findByText(/Version 1, saved by/);
      scenarios.serverError('setupTests.create');
      await user.click(screen.getByRole('button', { name: 'Test setup' }));
      expect(await screen.findByText('Internal server error')).toBeInTheDocument();
      expect(editor()).toHaveValue(setupScript);
    });
  });

  describe('environment tab', () => {
    const env = (more = '') => `${base()}?tab=environment${more}`;
    const acmeEnv = `/o/acme/p/${projectId}/desk/setup?tab=environment`;
    const varsNav = () => screen.getByRole('navigation', { name: 'Variables pagination' });
    const secretsNav = () => screen.getByRole('navigation', { name: 'Secrets pagination' });
    const entry = (kind: 'plain' | 'secret', i: number) => ({
      name: `${kind === 'plain' ? 'VAR' : 'SEC'}_${String(i).padStart(3, '0')}`,
      kind,
      value: kind === 'plain' ? `value-${i}` : null,
      updatedAt: '2026-11-12T10:00:00.000Z',
      updatedBy: 'kim-hale',
    });
    function seedEnv(variables: number, secrets: number) {
      mockDb.state.environment[projectId] = [
        ...Array.from({ length: variables }, (_, i) => entry('plain', i + 1)),
        ...Array.from({ length: secrets }, (_, i) => entry('secret', i + 1)),
      ];
    }
    const addForm = (name: string) => screen.getByRole('group', { name });
    const tab = (name: string) => screen.getByRole('tab', { name });

    it.each(['member', 'viewer'] as const)('a %s sees Forbidden and no entry names', async (role) => {
      await renderRoute(acmeEnv, { scenario: () => scenarios.onboarding(role) });
      expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
      expect(screen.queryByText('DB_HOST')).not.toBeInTheDocument();
    });

    it('?tab=bogus falls back to the script tab', async () => {
      await renderRoute(`${base()}?tab=bogus`);
      expect(await screen.findByRole('textbox', { name: 'Setup script' })).toBeInTheDocument();
      expect(tab('Setup script')).toHaveAttribute('aria-selected', 'true');
    });

    it('?tab=environment opens the tab, and the tab choice is kept in the URL', async () => {
      const { user, router } = await renderRoute(env());
      expect(await screen.findByText('DB_HOST')).toBeInTheDocument();
      expect(tab('Environment')).toHaveAttribute('aria-selected', 'true');
      await user.click(tab('Setup script'));
      await waitFor(() => expect(router.state.location.search).toEqual({}));
      await user.click(tab('Environment'));
      await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'environment' }));
    });

    it('both lists render from the API with their totals', async () => {
      await renderRoute(env());
      expect(await screen.findByText('DB_HOST')).toBeInTheDocument();
      expect(screen.getByText('db.internal.example.com')).toBeInTheDocument();
      expect(screen.getByText('3 variables')).toBeInTheDocument();
      expect(screen.getByText('NPM_TOKEN')).toBeInTheDocument();
      expect(screen.getByText('2 secrets')).toBeInTheDocument();
    });

    it('a secret value never reaches the DOM after a save (BR-17)', async () => {
      const { user } = await renderRoute(env());
      await screen.findByText('NPM_TOKEN');
      await user.click(screen.getByRole('button', { name: 'Add secret' }));
      await user.type(screen.getByLabelText('Name'), 'NEW_SECRET');
      await user.type(screen.getByLabelText(/^Value/), 'test-token-not-real-1');
      await user.click(within(addForm('Add secret')).getByRole('button', { name: 'Add secret' }));
      expect(await screen.findByText('NEW_SECRET')).toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain('test-token-not-real-1');
      expect(JSON.stringify(mockDb.state.environment)).not.toContain('test-token-not-real-1');
    });

    it('loading, then the error with Retry on each list, then the lists after a retry (BR-5)', async () => {
      scenarios.serverError('projectEnv.list', { delayMs: 30 });
      const { user } = await renderRoute(env());
      expect(await screen.findByText('Loading variables')).toBeInTheDocument();
      expect(screen.getByText('Loading secrets')).toBeInTheDocument();
      // The two lists are separate queries that each retry; findAllBy resolves on the first error, so wait for both.
      await waitFor(() =>
        expect(screen.getAllByText(/Could not load the environment\. Reload to try again\./)).toHaveLength(2),
      );
      server.resetHandlers();
      await user.click(screen.getAllByRole('button', { name: 'Retry' })[0] as HTMLElement);
      expect(await screen.findByText('DB_HOST')).toBeInTheDocument();
    });

    describe('paging (BR-27)', () => {
      it('Page 2 under the variables leaves the secrets and an open secret form as they are', async () => {
        seedEnv(23, 23);
        const { user, router } = await renderRoute(env());
        await screen.findByText('VAR_001');
        await user.click(screen.getByRole('button', { name: 'Add secret' }));
        await user.type(screen.getByLabelText('Name'), 'TYPED');
        await user.click(within(varsNav()).getAllByRole('button', { name: 'Page 2' })[0] as HTMLElement);
        expect(await screen.findByText('VAR_021')).toBeInTheDocument();
        expect(router.state.location.search).toEqual({ tab: 'environment', varsPage: '2' });
        expect(screen.getByText('SEC_001')).toBeInTheDocument();
        expect(secretsNav()).toHaveTextContent('Showing 1–20 of 23');
        expect(screen.getByLabelText('Name')).toHaveValue('TYPED');
      });

      it('?secretsPage=2 opens the secrets on page 2 and the variables on page 1', async () => {
        seedEnv(23, 23);
        await renderRoute(env('&secretsPage=2'));
        expect(await screen.findByText('SEC_021')).toBeInTheDocument();
        expect(screen.getByText('VAR_001')).toBeInTheDocument();
        expect(screen.queryByText('SEC_001')).not.toBeInTheDocument();
      });

      it.each(['0', 'x', '-1', '1.5'])('?varsPage=%s falls back to page 1', async (bad) => {
        seedEnv(23, 3);
        const { router } = await renderRoute(env(`&varsPage=${bad}`));
        expect(await screen.findByText('VAR_001')).toBeInTheDocument();
        expect(router.state.location.search).toEqual({ tab: 'environment' });
      });

      it('a page past the end is clamped to the last page', async () => {
        seedEnv(23, 3);
        const { router } = await renderRoute(env('&varsPage=99'));
        expect(await screen.findByText('VAR_021')).toBeInTheDocument();
        expect(router.state.location.search).toEqual({ tab: 'environment', varsPage: '2' });
      });

      it('removing the last entry of page 2 lands on the new last page', async () => {
        seedEnv(21, 1);
        const { user, router } = await renderRoute(env('&varsPage=2'));
        await user.click(await screen.findByRole('button', { name: 'Remove VAR_021' }));
        await user.click(screen.getByRole('button', { name: 'Remove variable' }));
        expect(await screen.findByText('VAR_020')).toBeInTheDocument();
        await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'environment' }));
      });
    });

    describe('writes', () => {
      it('create sends {name,value} and shows a Toast "Added NAME"', async () => {
        const bodies = capture('POST', '/env-vars');
        const { user } = await renderRoute(env());
        await screen.findByText('DB_HOST');
        await user.click(screen.getByRole('button', { name: 'Add variable' }));
        await user.type(screen.getByLabelText('Name'), 'AWS_REGION');
        await user.type(screen.getByLabelText(/^Value/), 'us-east-1');
        await user.click(within(addForm('Add variable')).getByRole('button', { name: 'Add variable' }));
        expect(await screen.findByText('Added AWS_REGION')).toBeInTheDocument();
        expect(await screen.findByText('us-east-1')).toBeInTheDocument();
        expect(bodies).toEqual([{ name: 'AWS_REGION', value: 'us-east-1' }]);
      });

      it('edit sends only {value}', async () => {
        const bodies = capture('PUT', '/env-vars/LOG_LEVEL');
        const { user } = await renderRoute(env());
        await user.click(await screen.findByRole('button', { name: 'Edit LOG_LEVEL' }));
        const value = screen.getByLabelText(/^Value/);
        await user.clear(value);
        await user.type(value, 'debug');
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('debug')).toBeInTheDocument();
        expect(bodies).toEqual([{ value: 'debug' }]);
      });

      it('a PUT answered 404 shows the row Banner and refetches the list without the entry (BR-28)', async () => {
        const { user } = await renderRoute(env());
        await user.click(await screen.findByRole('button', { name: 'Edit LOG_LEVEL' }));
        mockDb.state.environment[projectId] = (mockDb.state.environment[projectId] ?? []).filter(
          (e) => e.name !== 'LOG_LEVEL',
        );
        // Hold the refetch so the Banner can be seen before the row (and its form) leaves the list.
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        server.use(
          http.get(`*/api/projects/${projectId}/env`, async () => {
            await held;
            return undefined;
          }),
        );
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('This entry no longer exists. Reload the list.')).toBeInTheDocument();
        release();
        // The refreshed list has no row for it (the open form still names the entry above its message).
        await waitFor(() => expect(screen.getByText('2 variables')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Edit LOG_LEVEL' })).not.toBeInTheDocument();
        // The row is gone, the message is not: it stays until the owner closes the form.
        expect(screen.getByText('This entry no longer exists. Reload the list.')).toBeInTheDocument();
      });

      it('a save error keeps the typed input (BR-23)', async () => {
        const { user } = await renderRoute(env());
        await screen.findByText('DB_HOST');
        await user.click(screen.getByRole('button', { name: 'Add variable' }));
        await user.type(screen.getByLabelText('Name'), 'NEW_ONE');
        await user.type(screen.getByLabelText(/^Value/), 'kept-text');
        scenarios.serverError('projectEnv.createVar');
        await user.click(within(addForm('Add variable')).getByRole('button', { name: 'Add variable' }));
        expect(await screen.findByText('Internal server error')).toBeInTheDocument();
        expect(screen.getByLabelText('Name')).toHaveValue('NEW_ONE');
        expect(screen.getByLabelText(/^Value/)).toHaveValue('kept-text');
      });
    });

    describe('access (BR-29)', () => {
      it('the setup-reader sees both lists, no write control and the read-only note; writes answer 403', async () => {
        await renderRoute(acmeEnv, { scenario: () => scenarios.onboarding('setupReader') });
        expect(await screen.findByText('DB_HOST')).toBeInTheDocument();
        expect(screen.getByText('NPM_TOKEN')).toBeInTheDocument();
        expect(screen.getByText('You can see these but not change them.')).toBeInTheDocument();
        for (const name of [/^Add /, /^Edit /, /^Replace /, /^Remove /])
          expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
        const res = await fetch(`http://localhost:3000/api/projects/${projectId}/env-vars`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'X', value: 'y' }),
        });
        expect(res.status).toBe(403);
      });

      const withGrants = (permissions: ('setup:update' | 'secret:update')[]) =>
        server.use(
          http.get('*/api/me/access', () =>
            HttpResponse.json({
              userId: ids.user.alice,
              platformAdmin: false,
              assignments: [
                {
                  roleKey: 'custom',
                  scope: { type: 'org' },
                  permissions: (['project:read', 'setup:read', ...permissions] as const).map((permission) => ({
                    permission,
                    condition: 'any',
                  })),
                },
              ],
            }),
          ),
        );

      it('without secret:update only the secrets are read-only', async () => {
        withGrants(['setup:update']);
        await renderRoute(env());
        await screen.findByText('DB_HOST');
        expect(screen.getByRole('button', { name: 'Add variable' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add secret' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Replace / })).not.toBeInTheDocument();
      });

      it('without setup:update only the variables are read-only', async () => {
        withGrants(['secret:update']);
        await renderRoute(env());
        await screen.findByText('DB_HOST');
        expect(screen.queryByRole('button', { name: 'Add variable' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add secret' })).toBeInTheDocument();
      });
    });
  });
});
