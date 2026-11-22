import { screen } from '@testing-library/react';
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
});

describe('needs-you page', () => {
  it('a viewer sees the paused run and no Resume button', async () => {
    await open(`${base}/needs-you`, 'viewer', { [PAUSED]: ALICE });
    expect(await screen.findByText(/Run 64 is paused/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it('a member sees Resume only on their own paused run', async () => {
    await open(`${base}/needs-you`, 'member', { [PAUSED]: OTHER });
    expect(await screen.findByText(/Run 64 is paused/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it('a member sees Resume on their own paused run', async () => {
    await open(`${base}/needs-you`, 'member', { [PAUSED]: ALICE });
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it("an admin sees Resume on someone else's paused run", async () => {
    await open(`${base}/needs-you`, 'orgAdmin', { [PAUSED]: OTHER });
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
