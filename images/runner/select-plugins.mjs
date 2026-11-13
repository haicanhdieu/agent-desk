// Chooses which Claude Code plugins to install in the runner, from the repo's .claude/settings.json.
// Plain ESM with no dependencies: it runs inside the runner image before the agent starts.
//
// The settings text is untrusted. It is only parsed as JSON, never evaluated or interpolated. Every id part must
// match ID_PART or it is dropped silently. Plugins install only from marketplaces named in PLUGIN_MARKETPLACES,
// always from the configured source; the repo's `extraKnownMarketplaces` is ignored.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ID_PART = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {string} a @param {string} b */
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param {string | null} settingsText
 * @param {Record<string, string>} marketplaces configured store name to source
 * @returns {{ install: { plugin: string; store: string; source: string }[]; skipped: string[] }}
 */
export function selectPlugins(settingsText, marketplaces) {
  /** @type {{ install: { plugin: string; store: string; source: string }[]; skipped: string[] }} */
  const result = { install: [], skipped: [] };
  if (settingsText === null) return result;
  let settings;
  try {
    settings = JSON.parse(settingsText);
  } catch {
    return result;
  }
  if (!isRecord(settings) || !isRecord(settings.enabledPlugins)) return result;

  /** @type {{ plugin: string; store: string }[]} */
  const found = [];
  for (const [id, enabled] of Object.entries(settings.enabledPlugins)) {
    if (enabled !== true) continue;
    const parts = id.split('@');
    if (parts.length !== 2) continue;
    const [plugin, store] = parts;
    if (!ID_PART.test(plugin) || !ID_PART.test(store)) continue;
    found.push({ plugin, store });
  }
  found.sort((a, b) => compare(a.store, b.store) || compare(a.plugin, b.plugin));

  for (const { plugin, store } of found) {
    if (Object.hasOwn(marketplaces, store)) {
      result.install.push({ plugin, store, source: marketplaces[store] });
    } else {
      result.skipped.push(`${plugin}@${store}`);
    }
  }
  return result;
}

/** @param {string | undefined} raw @returns {Record<string, string> | null} */
function parseMarketplaces(raw) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  /** @type {Record<string, string>} */
  const out = {};
  for (const [store, source] of Object.entries(parsed)) {
    if (ID_PART.test(store) && typeof source === 'string' && source !== '') out[store] = source;
  }
  return out;
}

function main() {
  const file = process.argv[2];
  const marketplaces = parseMarketplaces(process.env.PLUGIN_MARKETPLACES);
  if (!file || !marketplaces) return;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  const { install, skipped } = selectPlugins(text, marketplaces);
  const lines = [
    ...install.map((i) => `install\t${i.plugin}\t${i.store}\t${i.source}`),
    ...skipped.map((s) => `skip\t${s}`),
  ];
  if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
