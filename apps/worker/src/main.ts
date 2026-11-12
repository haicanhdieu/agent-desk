import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { TASK_QUEUE, type Config } from '@agentdesk/core';
import type { Db } from '@agentdesk/db';
import { createActivities } from './activities';
import { ensureSchedules } from './schedules';
import { CONFIG, DB, WorkerModule } from './worker.module';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const config = app.get<Config>(CONFIG);
  const db = app.get<Db>(DB);

  const connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
  const nativeConnection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
  try {
    const client = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
    await ensureSchedules(client);
    const worker = await Worker.create({
      connection: nativeConnection,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: TASK_QUEUE,
      workflowsPath: fileURLToPath(new URL('./workflows/index.ts', import.meta.url)),
      activities: createActivities({ db, starter: client.workflow, gate: client.workflow }),
    });
    // The Temporal worker owns SIGINT/SIGTERM and drains in-flight activities; teardown happens only after it resolves.
    await worker.run();
  } finally {
    await nativeConnection.close();
    await connection.close();
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error('worker: failed', err instanceof Error ? err.message : err);
  process.exit(1);
});
