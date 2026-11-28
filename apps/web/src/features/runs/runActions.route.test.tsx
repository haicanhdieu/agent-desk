import { cleanup, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// Issue 216 (AC-18): on pages a user may open, run actions show only where they hold the permission on that run:
// a member on their own runs, an admin or owner on any, a viewer on none. The API stays the authority.

const P1 = ids.project.invoicerApi;
const base = `/o/acme/p/${P1}`;
const IDLE = 62;
const PAUSED = 64;
const ALICE = ids.user.alice;
const OTHER = 'user-someone-else';

const setOwner = (number: number, ownerUserId: string | null) => {
  const run = mockDb.state.runs.find((r) => r.projectId === P1 && r.number === number);
  if (!run) throw new Error(`run ${number} missing`);
  run.ownerUserId = ownerUserId;
};

type Seat = Parameters<typeof scenarios.onboarding>[0];
const open = (path: string, seat: Seat, owners: Record<number, string | null> = {}) =>
  renderRoute(path, {
    scenario: () => {
      scenarios.onboarding(seat);
      for (const [n, owner] of Object.entries(owners)) setOwner(Number(n), owner);
    },
  });

const idleRunLoaded = () => screen.findByText('The agent is waiting for your answer');
const actionButtons = () => ({
  finish: screen.queryAllByRole('button', { name: 'Finish run' }),
  stop: screen.queryAllByRole('button', { name: 'Stop session' }),
  cancel: screen.queryAllByRole('button', { name: 'Cancel run' }),
});

describe('run detail actions', () => {
  it('a viewer sees the run and none of its action buttons', async () => {
    await open(`${base}/runs/${IDLE}`, 'viewer', { [IDLE]: ALICE });
    await idleRunLoaded();
    expect(actionButtons()).toEqual({ finish: [], stop: [], cancel: [] });
  });

  it("a member sees no action buttons on someone else's run", async () => {
    await open(`${base}/runs/${IDLE}`, 'member', { [IDLE]: OTHER });
    await idleRunLoaded();
    expect(actionButtons()).toEqual({ finish: [], stop: [], cancel: [] });
  });

  it('a member sees no action buttons on a run with no owner', async () => {
    await open(`${base}/runs/${IDLE}`, 'member', { [IDLE]: null });
    await idleRunLoaded();
    expect(actionButtons().cancel).toEqual([]);
    expect(actionButtons().finish).toEqual([]);
  });

  it('a member sees Finish, Stop and Cancel on their own run', async () => {
    await open(`${base}/runs/${IDLE}`, 'member', { [IDLE]: ALICE });
    await idleRunLoaded();
    const { finish, stop, cancel } = actionButtons();
    expect(finish.length).toBeGreaterThan(0);
    expect(stop).toHaveLength(1);
    expect(cancel).toHaveLength(1);
  });

  it.each(['orgAdmin', 'owner'] as const)("an %s sees the action buttons on someone else's run", async (seat) => {
    await open(`${base}/runs/${IDLE}`, seat, { [IDLE]: OTHER });
    await idleRunLoaded();
    const { finish, cancel } = actionButtons();
    expect(finish.length).toBeGreaterThan(0);
    expect(cancel).toHaveLength(1);
  });

  it('a viewer sees no Resume or Finish on a paused run', async () => {
    await open(`${base}/runs/${PAUSED}`, 'viewer', { [PAUSED]: ALICE });
    expect(await screen.findByRole('link', { name: 'View issue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  });

  it('a member sees Resume on the detail page of their own paused run', async () => {
    await open(`${base}/runs/${PAUSED}`, 'member', { [PAUSED]: ALICE });
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it("a member sees no Resume on the detail page of someone else's paused run", async () => {
    await open(`${base}/runs/${PAUSED}`, 'member', { [PAUSED]: OTHER });
    expect(await screen.findByRole('link', { name: 'View issue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it("an admin sees Resume on the detail page of someone else's paused run", async () => {
    await open(`${base}/runs/${PAUSED}`, 'orgAdmin', { [PAUSED]: OTHER });
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });
});

describe('runs board banner', () => {
  it("a viewer sees the idle run's banner without Finish run", async () => {
    await open(`${base}/runs`, 'viewer', { [IDLE]: ALICE });
    expect(await screen.findByText(/Run 62 needs you\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish run' })).not.toBeInTheDocument();
  });

  it('a member sees Finish run on their own idle run only', async () => {
    await open(`${base}/runs`, 'member', { [IDLE]: ALICE });
    expect(await screen.findByRole('button', { name: 'Finish run' })).toBeInTheDocument();
  });

  it("a member sees no Finish run on someone else's idle run", async () => {
    await open(`${base}/runs`, 'member', { [IDLE]: OTHER });
    expect(await screen.findByText(/Run 62 needs you\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish run' })).not.toBeInTheDocument();
  });
});

describe('run detail actions, in the page header (BR-42)', () => {
  const header = () => {
    const h = within(screen.getByRole('main')).getByRole('heading', { level: 1 }).closest('header');
    if (!h) throw new Error('no page header');
    return h;
  };
  const headerActions = () =>
    within(header()).queryAllByRole('button', {
      name: /^(Finish run|Finish|Stop session|Cancel run|Resume|Close session)$/,
    });

  it('TC-42.1: a viewer sees status and ticket in the header and no run action', async () => {
    await open(`${base}/runs/${IDLE}`, 'viewer', { [IDLE]: ALICE });
    await idleRunLoaded();
    expect(within(header()).getByText('Needs you')).toBeInTheDocument();
    expect(headerActions()).toEqual([]);
  });

  it("TC-42.2: a member has no action in the header on someone else's run", async () => {
    await open(`${base}/runs/${IDLE}`, 'member', { [IDLE]: OTHER });
    await idleRunLoaded();
    expect(headerActions()).toEqual([]);
  });

  it('TC-42.3: a member has Finish run, Stop session and Cancel run in the header on their own run', async () => {
    await open(`${base}/runs/${IDLE}`, 'member', { [IDLE]: ALICE });
    await idleRunLoaded();
    expect(within(header()).getByRole('button', { name: 'Finish run' })).toBeEnabled();
    expect(within(header()).getByRole('button', { name: 'Stop session' })).toBeInTheDocument();
    expect(within(header()).getByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
  });

  it("TC-42.4: an org admin has the actions in the header on someone else's run", async () => {
    await open(`${base}/runs/${IDLE}`, 'orgAdmin', { [IDLE]: OTHER });
    await idleRunLoaded();
    expect(within(header()).getByRole('button', { name: 'Finish run' })).toBeEnabled();
    expect(within(header()).getByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
  });

  it('TC-42.5: a viewer has no Resume or Finish on a paused run, and a member on another run neither', async () => {
    await open(`${base}/runs/${PAUSED}`, 'viewer', { [PAUSED]: ALICE });
    await screen.findByRole('link', { name: 'View issue' });
    expect(headerActions()).toEqual([]);
    cleanup();
    await open(`${base}/runs/${PAUSED}`, 'member', { [PAUSED]: OTHER });
    await screen.findByRole('link', { name: 'View issue' });
    expect(headerActions()).toEqual([]);
    expect(screen.queryByRole('button', { name: /^(Resume|Finish)$/ })).not.toBeInTheDocument();
  });
});
