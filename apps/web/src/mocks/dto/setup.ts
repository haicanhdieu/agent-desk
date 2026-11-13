import type { PluginsDto, SetupScriptDto } from '@agentdesk/contracts';
import { setupScript } from '../setup';
import { ids } from './ids';

// Workspace setup (spec §5.5): the project's saved script history (oldest first) and the plugins the runner would
// install from its repo settings. A project without an entry has no script and no plugins.

/** invoicer-api has one saved version; every other project starts without a script (the empty state). */
export const setupScriptFixtures: Record<string, SetupScriptDto[]> = {
  [ids.project.invoicerApi]: [
    {
      version: 1,
      body: setupScript,
      note: 'Restore .NET tools before restore',
      createdBy: 'kim-hale',
      createdAt: '2026-11-10T09:30:00.000Z',
    },
  ],
};

const OFFICIAL = 'claude-plugins-official';

export const pluginFixtures: Record<string, PluginsDto> = {
  [ids.project.invoicerApi]: {
    approvedStores: [OFFICIAL],
    plugins: [
      { id: `superpowers@${OFFICIAL}`, name: 'superpowers', store: OFFICIAL, state: 'will_install' },
      { id: `context7@${OFFICIAL}`, name: 'context7', store: OFFICIAL, state: 'will_install' },
      { id: 'acme-lint@acme-tools', name: 'acme-lint', store: 'acme-tools', state: 'blocked' },
    ],
    settingsError: null,
  },
};

/** What a project without fixtures gets: the approved stores and no plugins. */
export const noPlugins = (): PluginsDto => ({ approvedStores: [OFFICIAL], plugins: [], settingsError: null });
