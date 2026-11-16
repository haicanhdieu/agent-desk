import path from 'node:path';
import {
  TestWorkflowEnvironment,
  type LocalTestWorkflowEnvironmentOptions,
  type TimeSkippingTestWorkflowEnvironmentOptions,
} from '@temporalio/testing';
import { z } from 'zod';

// The SDK downloads its test servers on first use. Where that is not possible (the runner pod after setup, an
// offline machine), point these at binaries installed beforehand (scripts/runner-setup.sh does it):
//   TEMPORAL_CLI_PATH          the `temporal` CLI, whose dev server backs createLocal()
//   TEMPORAL_TEST_SERVER_PATH  the time-skipping `temporal-test-server`, which backs createTimeSkipping()
type Env = Record<string, string | undefined>;

const binaryPath = (name: string) =>
  z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .refine((p) => path.isAbsolute(p), { message: `${name} must be an absolute path` })
      .optional(),
  );

const TemporalTestEnv = z.object({
  TEMPORAL_CLI_PATH: binaryPath('TEMPORAL_CLI_PATH'),
  TEMPORAL_TEST_SERVER_PATH: binaryPath('TEMPORAL_TEST_SERVER_PATH'),
});

function read(env: Env): z.infer<typeof TemporalTestEnv> {
  const parsed = TemporalTestEnv.safeParse(env);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  return parsed.data;
}

const existing = (p: string) => ({ executable: { type: 'existing-path' as const, path: p } });

export function localServerOptions(env: Env = process.env): LocalTestWorkflowEnvironmentOptions {
  const { TEMPORAL_CLI_PATH } = read(env);
  return TEMPORAL_CLI_PATH === undefined ? {} : { server: existing(TEMPORAL_CLI_PATH) };
}

export function timeSkippingServerOptions(env: Env = process.env): TimeSkippingTestWorkflowEnvironmentOptions {
  const { TEMPORAL_TEST_SERVER_PATH } = read(env);
  return TEMPORAL_TEST_SERVER_PATH === undefined ? {} : { server: existing(TEMPORAL_TEST_SERVER_PATH) };
}

/** `TestWorkflowEnvironment.createLocal()`, honouring TEMPORAL_CLI_PATH. */
export function createLocalTestEnv(): Promise<TestWorkflowEnvironment> {
  return TestWorkflowEnvironment.createLocal(localServerOptions());
}

/** `TestWorkflowEnvironment.createTimeSkipping()`, honouring TEMPORAL_TEST_SERVER_PATH. */
export function createTimeSkippingTestEnv(): Promise<TestWorkflowEnvironment> {
  return TestWorkflowEnvironment.createTimeSkipping(timeSkippingServerOptions());
}
