import { ApplicationFailure } from '@temporalio/common';
import { and, eq } from 'drizzle-orm';
import { projectEnvSecretName, type SecretStore } from '@agentdesk/core';
import { projectEnvVars, withOrg, type Db } from '@agentdesk/db';

export interface LoadedProjectEnv {
  plain: { name: string; value: string }[];
  secrets: Record<string, string>;
}

/** Most Secret reads in flight at once. */
export const PROJECT_ENV_READ_CONCURRENCY = 10;

/**
 * Load a project's env entries for a Job: plain values from Postgres, secret values from the SecretStore.
 * Runs inside an activity only; values must never reach workflow history, logs or error messages.
 */
export async function loadProjectEnv(
  db: Db,
  secrets: SecretStore,
  ctx: { orgId: string; projectId: string },
): Promise<LoadedProjectEnv> {
  const rows = await withOrg(db, ctx.orgId, (tx) =>
    tx
      .select({
        id: projectEnvVars.id,
        name: projectEnvVars.name,
        kind: projectEnvVars.kind,
        value: projectEnvVars.value,
      })
      .from(projectEnvVars)
      .where(and(eq(projectEnvVars.orgId, ctx.orgId), eq(projectEnvVars.projectId, ctx.projectId))),
  );

  const plain: LoadedProjectEnv['plain'] = [];
  const secretRows: { id: string; name: string }[] = [];
  for (const r of rows) {
    if (r.kind === 'secret') secretRows.push({ id: r.id, name: r.name });
    else plain.push({ name: r.name, value: r.value ?? '' });
  }

  // Entries, not an object keyed while loading: `out['__proto__'] = v` would set the prototype and drop the secret.
  const loaded: [string, string][] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < secretRows.length; i = next++) {
      const row = secretRows[i];
      if (!row) continue;
      let data: Record<string, string> | null;
      try {
        data = await secrets.get(projectEnvSecretName(ctx.orgId, row.id));
      } catch {
        // The store's error text is dropped on purpose: it could echo a value.
        throw new Error(`could not read the secret for variable ${row.name}`);
      }
      const value = data?.value;
      if (value === undefined) {
        throw ApplicationFailure.nonRetryable(
          `the secret for variable ${row.name} is missing; set it again`,
          'ProjectEnvSecretMissing',
        );
      }
      loaded.push([row.name, value]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROJECT_ENV_READ_CONCURRENCY, secretRows.length) }, worker));
  // fromEntries defines own keys, `__proto__` included.
  return { plain, secrets: Object.fromEntries(loaded) };
}
