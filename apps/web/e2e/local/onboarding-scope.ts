import { randomBytes } from 'node:crypto';
import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test';
import { asPlatformAdmin, createOrg } from './helpers';

export interface Org {
  id: string;
  slug: string;
  name: string;
}

/** Swaps `navigator.clipboard` for a stub whose writes the test can read back with `readText`. */
async function stubClipboard(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const store = window as unknown as { __copied?: string };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          store.__copied = text;
          return Promise.resolve();
        },
        readText: () => Promise.resolve(store.__copied ?? ''),
      },
    });
  });
}

/** The test's own resources: the platform admin's request context and every browser context it opened. */
export class Scope {
  pa!: APIRequestContext;
  readonly contexts: BrowserContext[] = [];
  readonly tag = randomBytes(4).toString('hex');

  /** `clipboard`: give every person a clipboard stub (for specs that read what "Copy link" wrote). */
  constructor(private readonly clipboard = false) {}

  async start(): Promise<this> {
    this.pa = await asPlatformAdmin();
    return this;
  }

  /** A fresh browser context: one person. */
  async person(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext();
    if (this.clipboard) await stubClipboard(context);
    this.contexts.push(context);
    return context;
  }

  handle(who: string): string {
    return `e2e-${who}-${this.tag}`;
  }

  email(who: string): string {
    return `${this.handle(who)}@dev.local`;
  }

  async org(label: string): Promise<Org> {
    const slug = `e2e-${label}-${this.tag}`;
    const name = `E2E ${label.toUpperCase()} ${this.tag}`;
    const created = await createOrg(this.pa, name, slug);
    return { id: created.id, slug, name };
  }

  async dispose(): Promise<void> {
    for (const context of this.contexts) await context.close().catch(() => null);
    await this.pa.dispose().catch(() => null);
  }
}

export async function withScope(
  body: (scope: Scope) => Promise<void>,
  options?: { clipboard?: boolean },
): Promise<void> {
  const scope = await new Scope(options?.clipboard).start();
  try {
    await body(scope);
  } finally {
    await scope.dispose();
  }
}
