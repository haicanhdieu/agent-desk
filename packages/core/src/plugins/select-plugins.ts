// TS twin of images/runner/select-plugins.mjs: the plugins panel previews exactly what the runner will install.
// Both are pinned by the shared fixture images/runner/test/fixtures/plugin-selection.json; change them together.
//
// The settings text is repo content, so it is untrusted: it is only parsed as JSON, never evaluated or interpolated.
import { z } from 'zod';

const ID_PART = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface PluginSelection {
  install: { plugin: string; store: string; source: string }[];
  skipped: string[];
}

const Settings = z.object({ enabledPlugins: z.record(z.string(), z.unknown()) });

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Chooses the plugins to install from a repo's `.claude/settings.json` text. Only `enabledPlugins` entries set to
 * `true` count; approval is by marketplace name against `marketplaces` (name to source), and the install source is
 * always the configured one. Unparseable or unexpected text selects nothing. Sorted by store, then plugin.
 */
export function selectPlugins(settingsText: string | null, marketplaces: Record<string, string>): PluginSelection {
  const result: PluginSelection = { install: [], skipped: [] };
  if (settingsText === null) return result;
  let json: unknown;
  try {
    json = JSON.parse(settingsText);
  } catch {
    return result;
  }
  const settings = Settings.safeParse(json);
  if (!settings.success) return result;

  const found: { plugin: string; store: string }[] = [];
  for (const [id, enabled] of Object.entries(settings.data.enabledPlugins)) {
    if (enabled !== true) continue;
    const parts = id.split('@');
    const [plugin, store] = parts;
    if (parts.length !== 2 || plugin === undefined || store === undefined) continue;
    if (!ID_PART.test(plugin) || !ID_PART.test(store)) continue;
    found.push({ plugin, store });
  }
  found.sort((a, b) => compare(a.store, b.store) || compare(a.plugin, b.plugin));

  for (const { plugin, store } of found) {
    const source = Object.hasOwn(marketplaces, store) ? marketplaces[store] : undefined;
    if (source !== undefined) result.install.push({ plugin, store, source });
    else result.skipped.push(`${plugin}@${store}`);
  }
  return result;
}

const hasControlChar = (s: string): boolean => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/**
 * The marketplaces the runner will actually accept: the same filter as its `PLUGIN_MARKETPLACES` parsing (valid store
 * name, non-empty source without control characters). Keeps the panel from promising a plugin the pod would skip.
 */
export function usableMarketplaces(configured: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [store, source] of Object.entries(configured)) {
    if (ID_PART.test(store) && source !== '' && !hasControlChar(source)) out[store] = source;
  }
  return out;
}
