// Tracing first: it registers the OTel provider before anything else loads (no-op unless configured).
import './tracing';
import 'reflect-metadata';
import { createApp } from './bootstrap';
import { CONFIG, type Config } from './config/config.module';

async function main(): Promise<void> {
  const app = await createApp();
  const config = app.get<Config>(CONFIG);
  await app.listen(config.PORT, '0.0.0.0');
}

main().catch((err: unknown) => {
  console.error('api: failed to start', err instanceof Error ? err.message : err);
  process.exit(1);
});
