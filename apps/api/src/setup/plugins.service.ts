import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PluginsDto } from '@agentdesk/contracts';
import { selectPlugins, usableMarketplaces } from '@agentdesk/core';
import type { OrgContext } from '../auth/org-context';
import { CONFIG, type Config } from '../config/config.module';
import { SkillsService } from '../skills/skills.service';

/** The repo's settings file, read at the project's default branch. */
const SETTINGS_PATH = '.claude/settings.json';

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const errorName = (err: unknown): string => (err instanceof Error ? err.name : 'unknown');

@Injectable()
export class PluginsService {
  private readonly log = new Logger(PluginsService.name);

  constructor(
    @Inject(SkillsService) private readonly skills: SkillsService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /**
   * What the runner will do with the plugins the repo enables. Needs only org membership (the project lookup is
   * RLS-scoped, so another org's project is a 404). The settings text is repo content: it is parsed as JSON by
   * `selectPlugins` and never logged, interpolated or returned.
   *
   * A missing file and unparseable JSON both give an empty list with no error (the runner ignores both the same way).
   * A provider failure gives `settingsError: 'unreadable'` and still a 200, so the tab renders; it is logged by error
   * name only because messages can quote repo text.
   */
  async get(org: OrgContext, projectId: string): Promise<PluginsDto> {
    const { host, project } = await this.skills.codeHostFor(org, projectId);
    const marketplaces = usableMarketplaces(this.config.RUN_PLUGIN_MARKETPLACES);
    const approvedStores = Object.keys(marketplaces).sort();
    let text: string | null;
    try {
      text = await host.readRepoFile(project, SETTINGS_PATH);
    } catch (err) {
      this.log.warn(`could not read plugin settings: ${errorName(err)}`);
      return { approvedStores, plugins: [], settingsError: 'unreadable' };
    }
    const { install, skipped } = selectPlugins(text, marketplaces);
    const toDto = (plugin: string, store: string, state: 'will_install' | 'blocked') => ({
      id: `${plugin}@${store}`,
      name: plugin,
      store,
      state,
    });
    const plugins = [
      ...install.map((i) => toDto(i.plugin, i.store, 'will_install')),
      ...skipped.map((id) => {
        const [plugin = '', store = ''] = id.split('@');
        return toDto(plugin, store, 'blocked');
      }),
    ];
    // One list in the same order selectPlugins uses: by store, then plugin.
    plugins.sort((a, b) => compare(a.store, b.store) || compare(a.name, b.name));
    return { approvedStores, plugins, settingsError: null };
  }
}
