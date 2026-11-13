import type { SetupTestDto } from '@agentdesk/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

const editor = () => screen.getByLabelText('Setup script');
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
    expect(screen.getByRole('heading', { level: 2, name: 'Workspace setup' })).toBeInTheDocument();
    expect(editor()).toHaveValue(setupScript);
    expect(screen.getByText(/Version 1, saved by kim-hale/)).toBeInTheDocument();
    expect(await screen.findByText('superpowers')).toBeInTheDocument();
    expect(screen.getByText('Blocked: store not approved')).toBeInTheDocument();
    const history = await screen.findByRole('list', { name: 'Setup script versions' });
    expect(within(history).getByText('Restore .NET tools before restore')).toBeInTheDocument();
    expect(screen.getByText('Not tested yet')).toBeInTheDocument();
  });

  it('the Desk nav links to workspace setup', async () => {
    await renderRoute(base());
    const desk = await screen.findByRole('navigation', { name: 'Desk' });
    expect(within(desk).getByRole('link', { name: /Workspace setup/ })).toHaveAttribute('href', base());
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
      expect(source.url).toBe(`/api/setup-tests/${id}/events`);
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
      serverSays({
        status: 'passed',
        exitCode: 0,
        finishedAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      });
      expect(await screen.findByText('Setup passed')).toBeInTheDocument();
      expect(within(screen.getByRole('list', { name: 'Setup phases' })).getByText('ready for you')).toBeInTheDocument();
      expect(screen.getByText(/Ends in \d+ min/)).toBeInTheDocument();
    });

    it('a failed setup shows "Setup failed" with the exit code', async () => {
      await startTest();
      serverLogs(1, { kind: 'checkout', text: 'x', sha: SHA });
      serverLogs(2, { kind: 'setup_failed', text: 'agentdesk: setup failed exit=1', exitCode: 1 });
      serverSays({ status: 'failed', exitCode: 1, checkoutSha: SHA });
      expect(await screen.findByText('Setup failed')).toBeInTheDocument();
      expect(within(screen.getByRole('list', { name: 'Setup phases' })).getByText('exit 1')).toBeInTheDocument();
    });

    it('opens the terminal at /api/setup-tests/:id/terminal once setup has finished, not before', async () => {
      await startTest();
      const id = dbTest().id;
      serverSays({ status: 'running' });
      expect(FakeWebSocket.instances).toHaveLength(0);
      serverSays({ status: 'passed', exitCode: 0, endsAt: new Date(Date.now() + 900_000).toISOString() });
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      expect(FakeWebSocket.latest().url).toBe(`ws://${window.location.host}/api/setup-tests/${id}/terminal`);
    });

    it('End test posts end; the workspace closes and the last-test banner shows', async () => {
      const { user } = await startTest();
      const id = dbTest().id;
      serverSays({
        status: 'passed',
        exitCode: 0,
        checkoutSha: SHA,
        endsAt: new Date(Date.now() + 900_000).toISOString(),
      });
      await user.click(await screen.findByRole('button', { name: 'End test' }));
      await waitFor(() => expect(mockDb.requests('POST', `/api/setup-tests/${id}/end`)).toBe(1));
      expect(await screen.findByText('Last test passed, matches the saved script')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'End test' })).not.toBeInTheDocument();
      expect(dbTest().status).toBe('ended');
    });

    it('saving a changed script makes the last test stale', async () => {
      const { user } = await startTest();
      serverSays({ status: 'passed', exitCode: 0, checkoutSha: SHA });
      await user.click(await screen.findByRole('button', { name: 'End test' }));
      await screen.findByText('Last test passed, matches the saved script');
      await user.type(editor(), '\necho more');
      await user.click(screen.getByRole('button', { name: 'Save version 2' }));
      expect(await screen.findByText('Last test passed, but the script changed since')).toBeInTheDocument();
    });

    it('View log opens an ended test as a log', async () => {
      const { user } = await startTest();
      serverLogs(1, { kind: 'setup_output', text: 'line from the test\n', truncated: false });
      serverSays({ status: 'passed', exitCode: 0, checkoutSha: SHA });
      await user.click(await screen.findByRole('button', { name: 'End test' }));
      await user.click(await screen.findByRole('button', { name: 'View log' }));
      expect(await screen.findByLabelText('Test workspace terminal')).toHaveTextContent('line from the test');
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
      expect(screen.queryByLabelText('Setup script')).not.toBeInTheDocument();
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
});
