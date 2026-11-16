import path from 'node:path';
import { z } from 'zod';

/**
 * Where `startPg()` (testing.ts) gets its Postgres from. Test-only; the app never reads these variables.
 * - `testcontainers` (default): a `postgres:18` container through the local container engine.
 * - `local`: a throwaway server from local Postgres binaries (`initdb` + `postgres`), for hosts without a
 *   container engine such as the runner pod (docs/runbooks/runner-pod.md).
 */
export type TestPgConfig =
  { mode: 'testcontainers' } | { mode: 'local'; binDir: string | undefined; dataRoot: string | undefined };

const blankToUndefined = (v: unknown): unknown => (v === '' ? undefined : v);
const absoluteDir = (name: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string()
      .refine((p) => path.isAbsolute(p), { message: `${name} must be an absolute path` })
      .optional(),
  );

const TestPgEnv = z.object({
  TEST_PG_MODE: z.preprocess(
    blankToUndefined,
    z.enum(['testcontainers', 'local'], { message: 'TEST_PG_MODE must be "testcontainers" or "local"' }).optional(),
  ),
  // Directory holding `initdb` and `postgres`; unset means look them up on PATH.
  TEST_PG_BIN_DIR: absoluteDir('TEST_PG_BIN_DIR'),
  // Parent of the per-server data directories; unset means the OS temp dir.
  TEST_PG_DATA_ROOT: absoluteDir('TEST_PG_DATA_ROOT'),
});

export function readTestPgConfig(env: Record<string, string | undefined> = process.env): TestPgConfig {
  const parsed = TestPgEnv.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid test Postgres settings: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  const { TEST_PG_MODE, TEST_PG_BIN_DIR, TEST_PG_DATA_ROOT } = parsed.data;
  if (TEST_PG_MODE !== 'local') return { mode: 'testcontainers' };
  return { mode: 'local', binDir: TEST_PG_BIN_DIR, dataRoot: TEST_PG_DATA_ROOT };
}
