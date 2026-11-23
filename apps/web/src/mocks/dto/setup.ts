import type { EnvEntryDto, PluginsDto, SetupScriptDto } from '@agentdesk/contracts';
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

// Project environment (workspace setup, Environment tab): plain variables and secrets of a project, both kinds in one
// list (the API's `kind` splits them). A secret entry never has a value (`value: null`). A project without an entry
// has none. Generated rows for paging come from `env` in msw/e2eLists.ts.
const envEntry = (name: string, kind: EnvEntryDto['kind'], value: string | null, updatedAt: string): EnvEntryDto => ({
  name,
  kind,
  value: kind === 'secret' ? null : value,
  updatedAt,
  updatedBy: 'kim-hale',
});

export const environmentFixtures: Record<string, EnvEntryDto[]> = {
  [ids.project.invoicerApi]: [
    envEntry('DB_HOST', 'plain', 'db.internal.example.com', '2026-11-12T10:00:00.000Z'),
    envEntry('LOG_LEVEL', 'plain', 'info', '2026-11-12T10:05:00.000Z'),
    envEntry('REGION', 'plain', 'eu-west-1', '2026-11-12T10:10:00.000Z'),
    envEntry('NPM_TOKEN', 'secret', null, '2026-11-13T09:00:00.000Z'),
    envEntry('SENTRY_DSN', 'secret', null, '2026-11-13T09:30:00.000Z'),
  ],
};
