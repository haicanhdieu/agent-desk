import { and, eq, exists, inArray, isNotNull, sql } from 'drizzle-orm';
import { agents, connections, projects, rules, type Tx } from '@agentdesk/db';
import type { OrgChecklistDto } from '@agentdesk/contracts';

/** Runs inside the caller's withOrg transaction. Without `visibleProjectIds` every project RLS lets the transaction see counts. Steps in the order connect_code_host, create_project, add_agent, add_rule. */
export async function orgChecklist(tx: Tx, visibleProjectIds?: readonly string[]): Promise<OrgChecklistDto> {
  const [code] = await tx
    .select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.status, 'active'), sql`(${connections.capabilities}->>'code')::boolean is true`))
    .limit(1);

  let focus: { id: string; hasAgent: boolean; hasRule: boolean } | null = null;
  if (visibleProjectIds === undefined || visibleProjectIds.length > 0) {
    const hasAgent = sql<boolean>`${exists(
      tx
        .select({ one: sql`1` })
        .from(agents)
        .where(and(eq(agents.projectId, projects.id), isNotNull(agents.credentialSecretName))),
    )}`;
    const hasRule = sql<boolean>`${exists(
      tx
        .select({ one: sql`1` })
        .from(rules)
        .where(eq(rules.projectId, projects.id)),
    )}`;
    const [row] = await tx
      .select({ id: projects.id, hasAgent, hasRule })
      .from(projects)
      .where(visibleProjectIds === undefined ? undefined : inArray(projects.id, [...visibleProjectIds]))
      .orderBy(
        sql`(case when ${hasAgent} then 1 else 0 end) + (case when ${hasRule} then 1 else 0 end) desc`,
        sql`${projects.createdAt} desc`,
        sql`${projects.id} desc`,
      )
      .limit(1);
    focus = row ?? null;
  }

  const addAgent = focus?.hasAgent === true;
  const addRule = focus?.hasRule === true;
  return {
    complete: addAgent && addRule,
    projectId: focus?.id ?? null,
    steps: [
      { key: 'connect_code_host', done: code !== undefined },
      { key: 'create_project', done: focus !== null },
      { key: 'add_agent', done: addAgent },
      { key: 'add_rule', done: addRule },
    ],
  };
}
