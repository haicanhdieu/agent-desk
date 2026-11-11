import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toId, storyNameFromExport, isExportStory } from 'storybook/internal/csf';
import { boardStories, storyHref } from '@/screens/storyIds';

const canvas = JSON.parse(
  readFileSync(resolve(__dirname, '../../../design/prototype/project/canvas.json'), 'utf8'),
) as { order: string[] };
const order = canvas.order.map((f) => f.replace(/\.dc\.html$/, ''));

type StoryModule = { default: { title: string; excludeStories?: unknown; includeStories?: unknown } } & Record<string, unknown>;
const modules = Object.values(
  import.meta.glob<StoryModule>('../screens/*.stories.tsx', { eager: true }),
);

describe('storybook coverage of prototype boards', () => {
  it('lists exactly the 24 boards of canvas.json, in order', () => {
    expect(order).toHaveLength(24);
    expect(Object.keys(boardStories)).toEqual(order);
  });

  it.each(order)('board %s has a story', (board) => {
    const { title, exportName } = boardStories[board as keyof typeof boardStories];
    const mod = modules.find((m) => m.default.title === title);
    expect(mod, `no stories file with title ${title}`).toBeDefined();
    expect(Object.keys(mod!), `${title} lacks export ${exportName}`).toContain(exportName);
  });

  it('has no screen story export that maps to no board', () => {
    const known = new Set(Object.values(boardStories).map((b) => `${b.title}#${b.exportName}`));
    const orphans: string[] = [];
    for (const m of modules) {
      for (const key of Object.keys(m)) {
        if (key === 'default' || !isExportStory(key, m.default as never)) continue;
        if (!known.has(`${m.default.title}#${key}`)) orphans.push(`${m.default.title}#${key}`);
      }
    }
    expect(orphans).toEqual([]);
  });
});

describe('storyHref', () => {
  it('builds Storybook ids from title and export name', () => {
    expect(storyHref('Main')).toBe('?path=/story/screens-overview--main');
    expect(storyHref('SignIn')).toBe('?path=/story/screens-entry--sign-in');
    expect(storyHref('RunStarting')).toBe('?path=/story/screens-run-detail--run-starting');
    expect(storyHref('Setup1')).toBe('?path=/story/screens-setup--setup-1');
    expect(storyHref('DeskSkillDelete')).toBe('?path=/story/screens-desk--desk-skill-delete');
  });

  it('matches Storybook toId for every board', () => {
    for (const board of order) {
      const { title, exportName } = boardStories[board as keyof typeof boardStories];
      expect(storyHref(board as keyof typeof boardStories)).toBe(
        `?path=/story/${toId(title, storyNameFromExport(exportName))}`,
      );
    }
  });
});
