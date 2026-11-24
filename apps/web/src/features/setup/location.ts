export interface PendingTab {
  go(url: string): void;
  close(): void;
}

/** Full-page navigation out of the app (provider install pages). An object so tests can spy on it in jsdom. */
export const browserLocation = {
  assign(url: string): void {
    window.location.assign(url);
  },
  /**
   * A blank tab for a page outside the app (the provider's install page), so the step the person is on stays open to
   * come back to. Call it in the click itself: a tab opened after an `await` is no longer the click's and is
   * blocked. `go` sends the tab to the page once its address is known; `close` drops it when there is no page to
   * show. Where the browser blocks the tab, `go` opens the page in this one and `close` does nothing.
   */
  openPendingTab(): PendingTab {
    const tab = window.open('', '_blank');
    if (!tab) return { go: (url) => browserLocation.assign(url), close: () => undefined };
    tab.opener = null;
    return {
      go: (url) => {
        tab.location.href = url;
      },
      close: () => tab.close(),
    };
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
