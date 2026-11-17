/**
 * Hosts the Vite dev server accepts besides localhost, from `WEB_ALLOWED_HOSTS`
 * (comma separated, e.g. a reverse-proxy hostname). Empty means Vite's default.
 */
export function parseAllowedHosts(raw: string | undefined): string[] {
  const hosts = (raw ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
  return [...new Set(hosts)];
}
