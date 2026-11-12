// Tracing first: it registers the OTel provider before anything else loads (no-op unless configured).
import { tracing } from './tracing';
import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { log as activityLog } from '@temporalio/activity';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import {
  TASK_QUEUE,
  systemClock,
  type AdapterRegistry,
  type Config,
  type KubeGateway,
  type SecretStore,
} from '@agentdesk/core';
import type { Db } from '@agentdesk/db';
import { createActivities } from './activities';
import { pollScheduleOps } from './activities/poll-ops';
import { temporalOps } from './activities/temporal-ops';
import { ensureSchedules } from './schedules';
import { ADAPTERS, CONFIG, DB, KUBE, SECRET_STORE, WorkerModule } from './worker.module';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const config = app.get<Config>(CONFIG);
  const db = app.get<Db>(DB);

  const connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
  const nativeConnection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
  try {
    const client = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE, plugins: tracing.plugins });
    await ensureSchedules(client);
    const ops = temporalOps(client);
    const worker = await Worker.create({
      connection: nativeConnection,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: TASK_QUEUE,
      plugins: tracing.plugins,
      workflowsPath: fileURLToPath(new URL('./workflows/index.ts', import.meta.url)),
      activities: createActivities({
        db,
        starter: client.workflow,
        gate: client.workflow,
        kube: app.get<KubeGateway>(KUBE),
        adapters: app.get<AdapterRegistry>(ADAPTERS),
        secrets: app.get<SecretStore>(SECRET_STORE),
        signaller: ops,
        temporal: ops,
        pollSchedules: pollScheduleOps(client),
        clock: systemClock,
        config,
        // Activity-context logger (carries workflow/activity ids); messages never include error text.
        log: { warn: (msg, meta) => activityLog.warn(msg, meta) },
      }),
    });
    // The Temporal worker owns SIGINT/SIGTERM and drains in-flight activities; teardown happens only after it resolves.
    await worker.run();
  } finally {
    await nativeConnection.close();
    await connection.close();
    await app.close();
    await tracing.shutdown();
  }
}

main().catch((err: unknown) => {
  console.error('worker: failed', err instanceof Error ? err.message : err);
  process.exit(1);
});
