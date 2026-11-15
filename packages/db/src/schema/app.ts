import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Tenant predicate. `current_setting(..., true)` yields NULL when `app.org_id` was never set and ''
 * after a transaction-local set_config has ended on a pooled connection; both must match no rows
 * instead of raising, so the policy is `org_id = NULL` (never true).
 */
const orgMatch = sql`org_id = nullif(current_setting('app.org_id', true), '')::uuid`;

const orgPolicy = () =>
  pgPolicy('org_isolation', { as: 'permissive', for: 'all', using: orgMatch, withCheck: orgMatch });

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    provider: text('provider').notNull(),
    capabilities: jsonb('capabilities').$type<{ code: boolean; board: boolean }>().notNull(),
    externalId: text('external_id').notNull(),
    accountName: text('account_name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull().default('active'),
    linkedByUserId: text('linked_by_user_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('connections_provider_external_id_key').on(t.provider, t.externalId),
    index('connections_org_idx').on(t.orgId),
    check('connections_status_check', sql`${t.status} in ('active','suspended','revoked')`),
    orgPolicy(),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    name: text('name').notNull(),
    repoPath: text('repo_path').notNull(),
    /** The repository's default branch as the code host reported it at project creation; issue runs check it out. */
    defaultBranch: text('default_branch'),
    codeConnectionId: uuid('code_connection_id')
      .notNull()
      .references(() => connections.id),
    boardConnectionId: uuid('board_connection_id')
      .notNull()
      .references(() => connections.id),
    triggerMode: text('trigger_mode').notNull().default('webhook'),
    pollIntervalSeconds: integer('poll_interval_seconds').notNull().default(300),
    maxConcurrentRuns: integer('max_concurrent_runs').notNull().default(2),
    maxRunsPerTicket: integer('max_runs_per_ticket').notNull().default(5),
    setupStep: text('setup_step').notNull().default('agent'),
    createdBy: text('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('projects_code_connection_repo_key').on(t.codeConnectionId, t.repoPath),
    index('projects_org_idx').on(t.orgId),
    index('projects_board_connection_idx').on(t.boardConnectionId),
    check('projects_trigger_mode_check', sql`${t.triggerMode} in ('webhook','polling')`),
    check('projects_poll_interval_check', sql`${t.pollIntervalSeconds} in (300,600,900,1800)`),
    check('projects_setup_step_check', sql`${t.setupStep} in ('agent','setup','skills','rules','ready')`),
    orgPolicy(),
  ],
);

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    provider: text('provider').notNull().default('claude'),
    model: text('model').notNull(),
    credentialSecretName: text('credential_secret_name'),
    credentialType: text('credential_type'),
    credentialUpdatedAt: ts('credential_updated_at'),
    credentialSetBy: text('credential_set_by'),
    maxTurns: integer('max_turns'),
    timeoutSeconds: integer('timeout_seconds').notNull().default(1800),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('agents_project_name_key').on(t.projectId, t.name),
    index('agents_org_idx').on(t.orgId),
    check('agents_timeout_check', sql`${t.timeoutSeconds} between 60 and 3300`),
    check('agents_credential_type_check', sql`${t.credentialType} in ('oauth_token','api_key')`),
    orgPolicy(),
  ],
);

export const rules = pgTable(
  'rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    command: text('command').notNull(),
    labelFilter: text('label_filter')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    target: text('target').notNull().default('any'),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    skillName: text('skill_name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('rules_project_command_key').on(t.projectId, t.command),
    index('rules_org_idx').on(t.orgId),
    index('rules_agent_idx').on(t.agentId),
    check('rules_target_check', sql`${t.target} in ('issue','pr','any')`),
    orgPolicy(),
  ],
);

export const inboundEvents = pgTable(
  'inbound_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    channel: text('channel').notNull(),
    deliveryId: text('delivery_id').notNull(),
    commentId: text('comment_id'),
    orgId: uuid('org_id'),
    projectId: uuid('project_id'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    event: text('event'),
    action: text('action'),
    outcome: text('outcome').notNull(),
    ticketRef: text('ticket_ref'),
    author: text('author'),
    command: text('command'),
    detail: text('detail'),
  },
  (t) => [
    unique('inbound_events_provider_delivery_key').on(t.provider, t.deliveryId),
    index('inbound_events_project_received_idx').on(t.projectId, t.receivedAt),
    check('inbound_events_channel_check', sql`${t.channel} in ('webhook','poll')`),
    orgPolicy(),
    // The intake records deliveries before the project is resolved, so it may insert rows with a null org.
    pgPolicy('intake_null_org_insert', { as: 'permissive', for: 'insert', withCheck: sql`org_id is null` }),
  ],
);

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Assigned by the runs_assign_number trigger; the inserted value is ignored. */
    number: integer('number').notNull().default(0),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ruleId: uuid('rule_id').references(() => rules.id, { onDelete: 'set null' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    command: text('command').notNull(),
    skillName: text('skill_name').notNull(),
    ticketRef: text('ticket_ref').notNull(),
    ticketKind: text('ticket_kind').notNull(),
    ticketNumber: integer('ticket_number'),
    ticketTitle: text('ticket_title'),
    ticketUrl: text('ticket_url'),
    ticketLabels: jsonb('ticket_labels')
      .$type<{ name: string; color: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    checkoutRef: text('checkout_ref').notNull(),
    args: text('args'),
    status: text('status').notNull().default('queued'),
    workflowId: text('workflow_id'),
    jobName: text('job_name'),
    triggerSource: text('trigger_source').notNull(),
    triggerCommentId: text('trigger_comment_id'),
    inboundEventId: uuid('inbound_event_id').references(() => inboundEvents.id, { onDelete: 'set null' }),
    triggeredBy: text('triggered_by'),
    queuedAt: ts('queued_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    idleSince: ts('idle_since'),
    exitCode: integer('exit_code'),
    failureReason: text('failure_reason'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }),
    outbox: jsonb('outbox').$type<Record<string, unknown>>().notNull().default({}),
    /** Setup script version this run used; null until recorded, or when the project had no script. */
    setupScriptVersion: integer('setup_script_version'),
    /** Which phase failed: 'setup' (repo setup script) or 'agent'. Null otherwise. */
    failureStage: text('failure_stage'),
    /** Why a running run is not busy with the agent itself: 'background' work. Null otherwise. */
    waitingOn: text('waiting_on'),
    /** One-line note the agent gave when it went idle or done. Null otherwise. */
    agentNote: text('agent_note'),
  },
  (t) => [
    unique('runs_project_trigger_comment_key').on(t.projectId, t.triggerCommentId),
    unique('runs_project_number_key').on(t.projectId, t.number),
    index('runs_org_idx').on(t.orgId),
    index('runs_project_status_idx').on(t.projectId, t.status),
    index('runs_project_ticket_idx').on(t.projectId, t.ticketRef),
    index('runs_rule_queued_idx').on(t.ruleId, t.queuedAt),
    index('runs_project_queued_idx').on(t.projectId, t.queuedAt.desc().nullsFirst(), t.id),
    index('runs_agent_idx').on(t.agentId),
    index('runs_inbound_event_idx').on(t.inboundEventId),
    check(
      'runs_status_check',
      sql`${t.status} in ('queued','starting','running','idle','done','succeeded','failed','cancelled','timed_out')`,
    ),
    check('runs_waiting_on_check', sql`${t.waitingOn} in ('background')`),
    check('runs_ticket_kind_check', sql`${t.ticketKind} in ('issue','pr')`),
    check('runs_trigger_source_check', sql`${t.triggerSource} in ('webhook','polling','manual')`),
    check('runs_failure_stage_check', sql`${t.failureStage} in ('setup','agent')`),
    orgPolicy(),
  ],
);

export const runEvents = pgTable(
  'run_events',
  {
    orgId: uuid('org_id').notNull(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    ts: ts('ts').notNull().defaultNow(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    primaryKey({ name: 'run_events_pkey', columns: [t.runId, t.seq] }),
    index('run_events_org_idx').on(t.orgId),
    check('run_events_type_check', sql`${t.type} in ('lifecycle','status','scrollback','comment')`),
    orgPolicy(),
  ],
);

/** A project setup script run in a throwaway sandbox. `scriptBody` is cleared when the test ends. */
export const setupTests = pgTable(
  'setup_tests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    scriptSha256: text('script_sha256').notNull(),
    scriptBody: text('script_body'),
    checkoutSha: text('checkout_sha'),
    plugins: jsonb('plugins')
      .$type<{ installed: unknown[]; skipped: unknown[]; failed: unknown[] }>()
      .notNull()
      .default({ installed: [], skipped: [], failed: [] }),
    exitCode: integer('exit_code'),
    startedBy: text('started_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    /** The setup result is known. */
    finishedAt: ts('finished_at'),
    /** The workspace was deleted. */
    endedAt: ts('ended_at'),
  },
  (t) => [
    index('setup_tests_project_created_idx').on(t.projectId, t.createdAt.desc()),
    index('setup_tests_org_idx').on(t.orgId),
    check('setup_tests_status_check', sql`${t.status} in ('queued','running','passed','failed','ended')`),
    check('setup_tests_script_body_check', sql`octet_length(${t.scriptBody}) <= 65536`),
    orgPolicy(),
  ],
);

export const setupTestEvents = pgTable(
  'setup_test_events',
  {
    orgId: uuid('org_id').notNull(),
    setupTestId: uuid('setup_test_id')
      .notNull()
      .references(() => setupTests.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    ts: ts('ts').notNull().defaultNow(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    primaryKey({ name: 'setup_test_events_pkey', columns: [t.setupTestId, t.seq] }),
    index('setup_test_events_org_idx').on(t.orgId),
    check('setup_test_events_type_check', sql`${t.type} in ('lifecycle','status')`),
    orgPolicy(),
  ],
);

export const pollCursors = pgTable(
  'poll_cursors',
  {
    projectId: uuid('project_id')
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull(),
    since: ts('since'),
    etag: text('etag'),
    lastPolledAt: ts('last_polled_at'),
    lastError: text('last_error'),
    failures: integer('failures').notNull().default(0),
    nextPollAt: ts('next_poll_at'),
    pausedReason: text('paused_reason'),
  },
  (t) => [index('poll_cursors_org_idx').on(t.orgId), orgPolicy()],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_org_at_idx').on(t.orgId, t.at), orgPolicy()],
);

/** Append-only history of a project's setup script; the highest version is current. No UPDATE/DELETE grant. */
export const setupScriptVersions = pgTable(
  'setup_script_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    note: text('note'),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('setup_script_versions_project_version_key').on(t.projectId, t.version),
    index('setup_script_versions_org_idx').on(t.orgId),
    check('setup_script_versions_body_check', sql`octet_length(${t.body}) <= 65536`),
    check('setup_script_versions_note_check', sql`${t.note} is null or char_length(${t.note}) <= 200`),
    orgPolicy(),
  ],
);
