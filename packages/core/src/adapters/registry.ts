import type { Config } from '../config';
import type { Clock } from '../clock';
import { FakeBoardAdapter } from './fake/board';
import { FakeCodeHostAdapter } from './fake/codehost';
import { FakeStore } from './fake/store';
import { GithubClients } from './github/app';
import { GithubBoardAdapter } from './github/board';
import { GithubCodeHostAdapter } from './github/codehost';
import type { AdapterRegistry, BoardAdapter, CodeHostAdapter, Provider } from './types';

export interface RegistryOptions {
  /** Injected HTTP transport for provider API calls (tests). */
  fetch?: typeof fetch;
}

export function createAdapterRegistry(config: Config, clock: Clock, opts: RegistryOptions = {}): AdapterRegistry {
  const boards = new Map<Provider, BoardAdapter>();
  const codeHosts = new Map<Provider, CodeHostAdapter>();

  if (
    config.GITHUB_APP_ID &&
    config.GITHUB_APP_SLUG &&
    config.GITHUB_PRIVATE_KEY &&
    config.GITHUB_WEBHOOK_SECRET &&
    config.GITHUB_CLIENT_ID &&
    config.GITHUB_CLIENT_SECRET
  ) {
    const clients = new GithubClients({
      appId: config.GITHUB_APP_ID,
      privateKey: config.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    boards.set('github', new GithubBoardAdapter(clients, clock, config.GITHUB_WEBHOOK_SECRET));
    codeHosts.set(
      'github',
      new GithubCodeHostAdapter(clients, clock, {
        appSlug: config.GITHUB_APP_SLUG,
        botName: config.BOT_NAME,
        botEmail: config.BOT_EMAIL,
      }),
    );
  }

  if (config.ENABLE_FAKE_PROVIDER) {
    const store = new FakeStore(config.FAKE_STATE_DIR, clock);
    boards.set('fake', new FakeBoardAdapter(store, clock, config.FAKE_WEBHOOK_SECRET));
    codeHosts.set('fake', new FakeCodeHostAdapter(store, clock, config.PUBLIC_ORIGIN));
  }

  const get = <T>(m: Map<Provider, T>, kind: string, provider: Provider): T => {
    const a = m.get(provider);
    if (!a) throw new Error(`no ${kind} adapter registered for provider "${provider}"`);
    return a;
  };

  return {
    board: (provider) => get(boards, 'board', provider),
    codeHost: (provider) => get(codeHosts, 'code host', provider),
    providers: () => [...new Set([...boards.keys(), ...codeHosts.keys()])],
  };
}
