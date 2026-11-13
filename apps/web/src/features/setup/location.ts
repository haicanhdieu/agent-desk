/** Full-page navigation out of the app (provider install pages). An object so tests can spy on it in jsdom. */
export const browserLocation = {
  assign(url: string): void {
    window.location.assign(url);
  },
  /** An in-app page in a new tab, so the step the person is on stays open. */
  openInNewTab(path: string): void {
    window.open(path, '_blank', 'noopener');
  },
};

/**
 * An install URL from the API, only when it is absolute https (http too in `mock` / `development` mode, for local
 * servers). Anything else (javascript:, data:, relative) is refused: the API response is not trusted to navigate.
 */
export function safeInstallUrl(url: string, mode: string = import.meta.env.MODE): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const allowHttp = mode === 'mock' || mode === 'development';
  if (parsed.protocol === 'https:' || (allowHttp && parsed.protocol === 'http:')) return parsed.href;
  return null;
}
