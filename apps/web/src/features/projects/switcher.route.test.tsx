import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

const base = `/o/alice/p/${ids.project.invoicerApi}`;
const switcher = () => screen.getByRole('button', { name: /^Switch project/ });

describe('project switcher in the top bar', () => {
  it('does not request the project list until the menu opens', async () => {
    const { user } = await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    expect(mockDb.requests('GET', '/api/projects')).toBe(0);

    await user.click(switcher());

    const menu = await screen.findByRole('dialog', { name: 'Projects' });
    await within(menu).findAllByRole('link');
    expect(mockDb.requests('GET', '/api/projects')).toBe(1);
  });

  it('opens a list of the org projects, marks the current one and links to the others', async () => {
    const { user } = await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    expect(switcher()).toHaveAttribute('aria-expanded', 'false');

    await user.click(switcher());

    expect(switcher()).toHaveAttribute('aria-expanded', 'true');
    const menu = await screen.findByRole('dialog', { name: 'Projects' });
    const seeded = mockDb.state.projects.filter((p) => p.orgId === ids.org.alice);
    expect(seeded.length).toBeGreaterThanOrEqual(2);
    for (const p of seeded) {
      const link = await within(menu).findByRole('link', { name: new RegExp(p.name) });
      expect(link).toHaveAttribute('href', `/o/alice/p/${p.id}/runs`);
      if (p.id === ids.project.invoicerApi) expect(link).toHaveAttribute('aria-current');
      else expect(link).not.toHaveAttribute('aria-current');
    }
  });

  it('shows an error with retry when the project list fails', async () => {
    const { user } = await renderRoute(`${base}/runs`, { scenario: () => scenarios.serverError('projects.list') });
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    await user.click(switcher());
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('project switcher navigation', () => {
  it('picking another project navigates to its runs and closes the menu', async () => {
    const { user, router } = await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    await user.click(switcher());
    const other = mockDb.state.projects.find((p) => p.orgId === ids.org.alice && p.id !== ids.project.invoicerApi);
    if (!other) throw new Error('seed has no second project');
    await user.click(await screen.findByRole('link', { name: new RegExp(other.name) }));
    expect(router.state.location.pathname).toBe(`/o/alice/p/${other.id}/runs`);
    expect(screen.queryByRole('dialog', { name: 'Projects' })).toBeNull();
  });
});

describe('project switcher with many projects', () => {
  function seed(total: number) {
    const [template] = mockDb.state.projects.filter((p) => p.orgId === ids.org.alice);
    if (!template) throw new Error('seed has no alice project');
    mockDb.state.projects = [
      template,
      ...Array.from({ length: total - 1 }, (_, i) => ({
        ...template,
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        name: `extra-${String(i + 1).padStart(3, '0')}`,
        repoPath: `dev/extra-${i + 1}`,
        createdAt: new Date(Date.UTC(2026, 11, 1, 0, 0, i)).toISOString(),
      })),
    ];
  }

  // The menu's footer holds "All projects" and "New project" (shell spec BR-48); the count is of the projects.
  const projectLinks = (menu: HTMLElement) =>
    within(menu)
      .getAllByRole('link')
      .filter((a) => !/^(All projects|New project)$/.test(a.textContent ?? ''));

  it('lists all 26 projects with one request for 100 rows', async () => {
    seed(26);
    const { user } = await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    await user.click(switcher());
    const menu = await screen.findByRole('dialog', { name: 'Projects' });
    await within(menu).findAllByRole('link');
    expect(projectLinks(menu)).toHaveLength(26);
    expect(mockDb.requests('GET', '/api/projects')).toBe(1);
  });

  it('lists 100 of 101 projects', async () => {
    seed(101);
    const { user } = await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    await user.click(switcher());
    const menu = await screen.findByRole('dialog', { name: 'Projects' });
    await within(menu).findAllByRole('link');
    expect(projectLinks(menu)).toHaveLength(100);
  });
});
