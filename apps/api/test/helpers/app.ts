import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { AppModule } from '../../src/app.module';
import { configureApp, createAdapter } from '../../src/bootstrap';
import { createLogger } from '../../src/common/logger';
import { CONFIG } from '../../src/config/config.module';
import { parseConfig, type Config } from '../../src/config/config.schema';
import { DB } from '../../src/db/db.module';
import { TEMPORAL_CLIENT } from '../../src/temporal/temporal-client.module';
import { FakeTemporalClient } from './fake-temporal';

export { FakeTemporalClient } from './fake-temporal';

/** A minimal valid environment for parseConfig (no database urls pointing anywhere real). */
export function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'http://localhost:5173',
    DATABASE_APP_URL: 'postgres://app@localhost:1/agentdesk',
    DATABASE_OWNER_URL: 'postgres://owner@localhost:1/agentdesk',
    DATABASE_ADMIN_URL: 'postgres://admin@localhost:1/postgres',
    TEMPORAL_ADDRESS: 'localhost:7233',
    TEMPORAL_NAMESPACE: 'agentdesk',
    BETTER_AUTH_SECRET: 'test-only-better-auth-secret-0123456789abcdef',
    KUBE_MODE: 'fake',
    RUNNER_IMAGE: 'agentdesk-runner:test',
    ENABLE_FAKE_PROVIDER: 'true',
    AUTH_DEV_LOGIN: 'true',
    ...overrides,
  };
}

export interface TestAppOptions {
  /** Extra env keys (strings) merged over validEnv. */
  env?: Record<string, string>;
  /** Test-only controllers registered next to the real ones. */
  controllers?: Type[];
}

export interface TestApp {
  app: NestFastifyApplication;
  db: Db;
  config: Config;
  temporal: FakeTemporalClient;
  pg: TestPg;
  close: () => Promise<void>;
}

// One Postgres container per test file: each vitest file has its own module registry, so this cache is
// file-scoped. It is reference-counted so close() of the last app in the file stops the container.
let shared: { pg: Promise<TestPg>; refs: number } | undefined;

async function acquirePg(): Promise<TestPg> {
  shared ??= { pg: startPg(), refs: 0 };
  shared.refs += 1;
  return shared.pg;
}

async function releasePg(): Promise<void> {
  if (!shared) return;
  shared.refs -= 1;
  if (shared.refs > 0) return;
  const { pg } = shared;
  shared = undefined;
  await (await pg).stop();
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const pg = await acquirePg();
  try {
    const config = parseConfig(
      validEnv({
        DATABASE_APP_URL: pg.appUrl,
        DATABASE_OWNER_URL: pg.ownerUrl,
        DATABASE_ADMIN_URL: pg.adminUrl,
        ...options.env,
      }),
    );
    const db = createDb(config.DATABASE_APP_URL);
    const temporal = new FakeTemporalClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: options.controllers ?? [] })
      .overrideProvider(CONFIG)
      .useValue(config)
      .overrideProvider(DB)
      .useValue(db)
      .overrideProvider(TEMPORAL_CLIENT)
      .useValue(temporal.client)
      .compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(), { logger: false });
    configureApp(app, createLogger('silent'));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    let closed = false;
    return {
      app,
      db,
      config,
      temporal,
      pg,
      close: async () => {
        if (closed) return;
        closed = true;
        await app.close();
        await releasePg();
      },
    };
  } catch (err) {
    await releasePg();
    throw err;
  }
}
