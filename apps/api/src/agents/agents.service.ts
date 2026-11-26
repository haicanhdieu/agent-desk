import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { agents, projects, rules, runs, withOrg, type Db, type Tx } from '@agentdesk/db';
import {
  AGENT_KIND_CAPABILITIES,
  AGENT_TEST_MESSAGES,
  AgentKind,
  AgentTestStatus,
  CredentialType,
  pageWindow,
  toPage,
  type AgentConnectionDto,
  type AgentDto,
  type AgentModelsDto,
  type CreateAgentRequest,
  type Page,
  type PageQuery,
  type PutAgentRequest,
  type PutCredentialRequest,
  type PutCredentialResponse,
  type UpdateAgentRequest,
} from '@agentdesk/contracts';
import {
  AgentModelsError,
  agentAdapterFor,
  credentialMatchesAddress,
  credentialSecretData,
  credentialSecretName,
  parseCredentialSecret,
  type AgentHttpGet,
  type Clock,
  type SecretStore,
} from '@agentdesk/core';
import type { OrgContext } from '../auth/org-context';
import { CONFIG, type Config } from '../config/config.module';
import { CLOCK } from '../common/clock';
import { describeError, foreignKeyViolation, uniqueViolationConstraint } from '../common/pg-errors';
import {
  ConflictProblemException,
  UnprocessableProblemException,
  ValidationProblemException,
} from '../common/zod-validation';
import { DB } from '../db/db.module';
import { assertProjectVisible } from '../projects/project-access';
import { SECRET_STORE } from '../secrets/secret-store.module';
import { AGENT_HTTP } from './agent-http.provider';
import { blockingRunsCondition } from './blocking-runs';

type AgentRow = typeof agents.$inferSelect;
type AgentTestStatusWord = AgentTestStatus;

/** The most bytes of a pasted credentials file (a Codex auth.json or an OpenCode export). */
const AUTH_JSON_MAX_BYTES = 65536;
/** The most rule commands a refused delete lists. */
const RULE_LIST_MAX = 5;
const DEFAULT_KEY = 'agents_project_default_key';

const NAME_TAKEN = (): ConflictProblemException =>
  new ConflictProblemException('An agent with this name already exists in this project', [
    { pointer: '/name', detail: 'An agent with this name already exists in this project' },
  ]);

/** The refusal for the lowest-numbered run that still needs the agent (a succeeded run here keeps a session). */
function blockingRunText(number: number, status: string): string {
  if (status === 'succeeded')
    return `Run ${number} has a kept session that can be reopened. Close it first, then delete.`;
  if (status === 'paused') return `Run ${number} is paused and can be resumed. Finish it first, then delete.`;
  return `Run ${number} is ${status}. Finish it first, then delete.`;
}

/** Maps the violated name constraint of a failed write to the 409 on /name; any other error is rethrown. */
function nameConflict(err: unknown): never {
  const constraint = uniqueViolationConstraint(err);
  if (constraint !== null && constraint.startsWith('agents_project_name')) throw NAME_TAKEN();
  throw err;
}

interface Limits {
  timeoutSeconds: number;
  pausedKeepSeconds: number;
  doneKeepSeconds: number;
  idleEndSeconds: number;
  autoResumeMax: number;
}

function toDto(row: AgentRow, limits: Limits, usage: { rules: number; blockingRuns: number }): AgentDto {
  const type = row.credentialType === null ? null : CredentialType.parse(row.credentialType);
  const status = row.lastTestStatus === null ? null : AgentTestStatus.parse(row.lastTestStatus);
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    provider: AgentKind.parse(row.provider),
    model: row.model,
    baseUrl: row.baseUrl,
    maxTurns: row.maxTurns,
    // The run limits are project-wide; the old per-agent columns are unread.
    ...limits,
    credential: {
      set: type !== null && row.credentialUpdatedAt !== null,
      type,
      updatedAt: row.credentialUpdatedAt?.toISOString() ?? null,
      setBy: row.credentialSetBy,
    },
    accountLabel: row.accountLabel,
    isDefault: row.isDefault,
    lastTest: status !== null && row.lastTestAt !== null ? { status, at: row.lastTestAt.toISOString() } : null,
    usage,
  };
}

/** The DTOs of agents of one project: the project's limits once, usage from two grouped counts over `rows`' ids. */
async function dtosOf(tx: Tx, projectId: string, rows: AgentRow[]): Promise<AgentDto[]> {
  if (rows.length === 0) return [];
  const [limits] = await tx
    .select({
      timeoutSeconds: projects.timeoutSeconds,
      pausedKeepSeconds: projects.pausedKeepSeconds,
      doneKeepSeconds: projects.doneKeepSeconds,
      idleEndSeconds: projects.idleEndSeconds,
      autoResumeMax: projects.autoResumeMax,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!limits) throw new NotFoundException('Project not found');
  const ids = rows.map((r) => r.id);
  const ruleCounts = await tx
    .select({ id: rules.agentId, n: count() })
    .from(rules)
    .where(and(eq(rules.projectId, projectId), inArray(rules.agentId, ids)))
    .groupBy(rules.agentId);
  // A run blocks a delete while it is not final, or while a succeeded run's kept session can be reopened.
  const runCounts = await tx
    .select({ id: runs.agentId, n: count() })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), inArray(runs.agentId, ids), blockingRunsCondition()))
    .groupBy(runs.agentId);
  const ruleBy = new Map(ruleCounts.map((c) => [c.id, c.n]));
  const runBy = new Map(runCounts.map((c) => [c.id, c.n]));
  return rows.map((r) => toDto(r, limits, { rules: ruleBy.get(r.id) ?? 0, blockingRuns: runBy.get(r.id) ?? 0 }));
}

async function dtoOf(tx: Tx, row: AgentRow): Promise<AgentDto> {
  const [dto] = await dtosOf(tx, row.projectId, [row]);
  if (!dto) throw new NotFoundException('Agent not found');
  return dto;
}

/** The project row, locked: serialises the writes that must keep exactly one default agent. */
async function lockProject(tx: Tx, projectId: string): Promise<void> {
  const rows = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for('update');
  if (!rows[0]) throw new NotFoundException('Project not found');
}

async function agentById(tx: Tx, agentId: string): Promise<AgentRow> {
  const row = (await tx.select().from(agents).where(eq(agents.id, agentId)).limit(1))[0];
  if (!row) throw new NotFoundException('Agent not found');
  await assertProjectVisible(tx, row.projectId);
  return row;
}

function hostOf(baseUrl: string | null): string {
  if (baseUrl === null) return 'default';
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'invalid';
  }
}

const valueRefused = (detail: string): UnprocessableProblemException =>
  new UnprocessableProblemException('The credential is not valid', [{ pointer: '/value', detail }]);

/** A credentials file must be a JSON object of at most 64 KiB. Never echoes any part of the text. */
function checkAuthJson(value: string): void {
  if (Buffer.byteLength(value, 'utf8') > AUTH_JSON_MAX_BYTES) throw valueRefused('The file is larger than 64 KiB');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw valueRefused('The file is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw valueRefused('The file must be a JSON object');
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(AGENT_HTTP) private readonly http: AgentHttpGet,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(org: OrgContext, projectId: string, q: PageQuery): Promise<Page<AgentDto>> {
    const { limit, offset } = pageWindow(q);
    return withOrg(this.db, org.orgId, async (tx) => {
      await assertProjectVisible(tx, projectId);
      const [counted] = await tx.select({ n: count() }).from(agents).where(eq(agents.projectId, projectId));
      const rows = await tx
        .select()
        .from(agents)
        .where(eq(agents.projectId, projectId))
        .orderBy(desc(agents.isDefault), asc(sql`lower(${agents.name})`), asc(agents.id))
        .limit(limit)
        .offset(offset);
      return toPage(await dtosOf(tx, projectId, rows), counted?.n ?? 0, q);
    });
  }

  /**
   * Adds an agent. The project row is locked, so the default flag is decided without a race: the new agent is the
   * default only when the project has none. A 23505 on the default index (a writer that skipped the lock) retries
   * once as a non-default insert.
   */
  async create(org: OrgContext, projectId: string, body: CreateAgentRequest): Promise<AgentDto> {
    const adapter = agentAdapterFor(body.provider, { http: this.http });
    const cap = AGENT_KIND_CAPABILITIES[body.provider];
    const model = body.model ?? (cap.modelOptional ? '' : (adapter.builtinModels[0]?.id ?? ''));
    const attempt = (forceNonDefault: boolean): Promise<AgentDto> =>
      withOrg(this.db, org.orgId, async (tx) => {
        await assertProjectVisible(tx, projectId);
        await lockProject(tx, projectId);
        const hasDefault =
          forceNonDefault ||
          (
            await tx
              .select({ id: agents.id })
              .from(agents)
              .where(and(eq(agents.projectId, projectId), eq(agents.isDefault, true)))
              .limit(1)
          ).length > 0;
        const [row] = await tx
          .insert(agents)
          .values({
            orgId: org.orgId,
            projectId,
            provider: body.provider,
            name: body.name,
            accountLabel: body.accountLabel ?? null,
            model,
            maxTurns: body.maxTurns ?? null,
            isDefault: !hasDefault,
          })
          .returning();
        if (!row) throw new Error('agent insert returned no row');
        return dtoOf(tx, row);
      });
    try {
      return await attempt(false);
    } catch (err) {
      if (uniqueViolationConstraint(err) === DEFAULT_KEY) return attempt(true);
      return nameConflict(err);
    }
  }

  async update(org: OrgContext, agentId: string, body: UpdateAgentRequest): Promise<AgentDto> {
    try {
      return await withOrg(this.db, org.orgId, async (tx) => {
        const row = await agentById(tx, agentId);
        const set: Partial<typeof agents.$inferInsert> = {};
        if (body.name !== undefined) set.name = body.name;
        if (body.accountLabel !== undefined) set.accountLabel = body.accountLabel;
        if (body.maxTurns !== undefined) set.maxTurns = body.maxTurns;
        if (body.model !== undefined) {
          if (body.model === '' && !AGENT_KIND_CAPABILITIES[AgentKind.parse(row.provider)].modelOptional) {
            throw new ValidationProblemException([{ pointer: '/model', detail: 'Choose a model' }]);
          }
          set.model = body.model;
        }
        if (Object.keys(set).length === 0) return dtoOf(tx, row);
        const [saved] = await tx.update(agents).set(set).where(eq(agents.id, agentId)).returning();
        if (!saved) throw new NotFoundException('Agent not found');
        return dtoOf(tx, saved);
      });
    } catch (err) {
      return nameConflict(err);
    }
  }

  /** Lock order is always the project row, then the agent rows. */
  setDefault(org: OrgContext, agentId: string): Promise<AgentDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      const found = await agentById(tx, agentId);
      await lockProject(tx, found.projectId);
      const row = (await tx.select().from(agents).where(eq(agents.id, agentId)).for('update'))[0];
      if (!row) throw new NotFoundException('Agent not found');
      if (row.isDefault) return dtoOf(tx, row);
      // The old default is cleared first: the partial unique index is checked per statement.
      await tx
        .update(agents)
        .set({ isDefault: false })
        .where(and(eq(agents.projectId, row.projectId), eq(agents.isDefault, true)));
      const [saved] = await tx.update(agents).set({ isDefault: true }).where(eq(agents.id, agentId)).returning();
      if (!saved) throw new NotFoundException('Agent not found');
      return dtoOf(tx, saved);
    });
  }

  /**
   * Hard delete. The project row is locked first (the order every default-flag writer uses), then the agent row, so a
   * rule or run insert (a key-share lock on the agent) and a set-default or create serialise with it. The 409s are
   * checked in a fixed order: the only agent, the default, a rule that names it, a run that still needs it. The
   * credential Secret goes after the commit and its failure never fails the request.
   */
  async remove(org: OrgContext, agentId: string): Promise<void> {
    try {
      await withOrg(this.db, org.orgId, async (tx) => {
        const found = await agentById(tx, agentId);
        await lockProject(tx, found.projectId);
        const row = (await tx.select().from(agents).where(eq(agents.id, agentId)).for('update'))[0];
        if (!row) throw new NotFoundException('Agent not found');
        const [siblings] = await tx.select({ n: count() }).from(agents).where(eq(agents.projectId, row.projectId));
        if ((siblings?.n ?? 0) <= 1) {
          throw new ConflictException('A project needs at least one agent. Add another agent first.');
        }
        if (row.isDefault) throw new ConflictException('Set another agent as default first');
        const named = await tx
          .select({ command: rules.command })
          .from(rules)
          .where(and(eq(rules.projectId, row.projectId), eq(rules.agentId, agentId)))
          .orderBy(asc(rules.command))
          .limit(RULE_LIST_MAX + 1);
        if (named.length > 0) {
          const [total] = await tx
            .select({ n: count() })
            .from(rules)
            .where(and(eq(rules.projectId, row.projectId), eq(rules.agentId, agentId)));
          const shown = named.slice(0, RULE_LIST_MAX).map((r) => `/${r.command}`);
          const more = (total?.n ?? named.length) - shown.length;
          throw new ConflictException(
            `${total?.n ?? named.length} ${(total?.n ?? named.length) === 1 ? 'rule names' : 'rules name'} it: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}. Point it at another agent first, then delete.`,
          );
        }
        const [busy] = await tx
          .select({ number: runs.number, status: runs.status })
          .from(runs)
          .where(and(eq(runs.projectId, row.projectId), eq(runs.agentId, agentId), blockingRunsCondition()))
          .orderBy(asc(runs.number))
          .limit(1);
        if (busy) throw new ConflictException(blockingRunText(busy.number, busy.status));
        await tx.delete(agents).where(eq(agents.id, agentId));
      });
    } catch (err) {
      // A rule or run insert that slipped in (23503) is the same answer as one found by the checks.
      if (foreignKeyViolation(err)) {
        throw new ConflictException('A rule or run still uses this agent. Try again once it is free.');
      }
      throw err;
    }
    try {
      await this.secrets.delete(credentialSecretName(org.orgId, agentId));
    } catch (err) {
      // An orphaned Secret is harmless (nothing reads it); log the class only: a store error can echo material.
      this.logger.error(
        `credential store delete failed for agent ${agentId}: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
  }

  /**
   * Checks the saved credential against the provider. The adapter call runs outside any transaction; the result is
   * stored in a short one, only while the credential and address are still the ones that were tested. No credential
   * on a kind that needs one answers `no_credential` and stores nothing; a kind that runs without one is asked
   * anyway (its adapter answers `unsupported` with no outbound call).
   */
  async test(org: OrgContext, agentId: string): Promise<AgentConnectionDto> {
    const agent = await withOrg(this.db, org.orgId, (tx) => agentById(tx, agentId));
    const kind = AgentKind.parse(agent.provider);
    const adapter = agentAdapterFor(kind, { http: this.http });
    const hasMeta = agent.credentialType !== null && agent.credentialUpdatedAt !== null;
    let credential: { type: CredentialType; value: string } | null = null;
    if (hasMeta) {
      let stored: Record<string, string> | null;
      try {
        stored = await this.secrets.get(credentialSecretName(org.orgId, agentId));
      } catch (err) {
        this.logger.error(
          `credential store read failed for agent ${agentId}: ${err instanceof Error ? err.name : 'unknown'}`,
        );
        // eslint-disable-next-line preserve-caught-error -- deliberate: the cause may echo secret material.
        throw new Error('credential store unavailable');
      }
      const parsed = parseCredentialSecret(stored);
      // A missing or unusable Secret, or one saved for another address, is no credential; it is never sent anywhere.
      if (parsed && credentialMatchesAddress(parsed, agent.baseUrl))
        credential = { type: parsed.type, value: parsed.value };
    }
    if (credential === null && !AGENT_KIND_CAPABILITIES[kind].credentialOptional) {
      return { status: 'no_credential', message: AGENT_TEST_MESSAGES.no_credential, testedAt: null };
    }
    let status: AgentTestStatusWord;
    try {
      status = await adapter.checkConnection({ credential, baseUrl: agent.baseUrl });
    } catch (err) {
      this.logger.warn(`connection check failed for agent ${agentId}: ${describeError(err)}`);
      status = 'unreachable';
    }
    const at = this.clock.now();
    await withOrg(this.db, org.orgId, (tx) =>
      tx
        .update(agents)
        .set({ lastTestStatus: status, lastTestAt: at })
        .where(
          and(
            eq(agents.id, agentId),
            sql`${agents.credentialUpdatedAt} is not distinct from ${agent.credentialUpdatedAt}`,
            sql`${agents.baseUrl} is not distinct from ${agent.baseUrl}`,
          ),
        ),
    );
    const host = status === 'unreachable' && agent.baseUrl !== null ? ` (${hostOf(agent.baseUrl)})` : '';
    return { status, message: `${AGENT_TEST_MESSAGES[status]}${host}`, testedAt: at.toISOString() };
  }

  /** Compat: the project's default agent. */
  get(org: OrgContext, projectId: string): Promise<AgentDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await assertProjectVisible(tx, projectId);
      const row = (
        await tx
          .select()
          .from(agents)
          .where(and(eq(agents.projectId, projectId), eq(agents.isDefault, true)))
          .limit(1)
      )[0];
      if (!row) throw new NotFoundException('Agent not found');
      return dtoOf(tx, row);
    });
  }

  /** Compat: writes the default agent's model and max turns and the project's five run limits. */
  put(org: OrgContext, projectId: string, body: PutAgentRequest): Promise<AgentDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await assertProjectVisible(tx, projectId);
      // Project row first, like every other writer of the default flag.
      await lockProject(tx, projectId);
      const current = (
        await tx
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.projectId, projectId), eq(agents.isDefault, true)))
          .limit(1)
      )[0];
      if (!current) throw new NotFoundException('Agent not found');
      const [row] = await tx
        .update(agents)
        .set({ model: body.model, maxTurns: body.maxTurns ?? null })
        .where(eq(agents.id, current.id))
        .returning();
      if (!row) throw new NotFoundException('Agent not found');
      // Absent keeps the stored value (undefined is skipped by drizzle); the run time limit is always sent.
      await tx
        .update(projects)
        .set({
          timeoutSeconds: body.timeoutSeconds,
          pausedKeepSeconds: body.pausedKeepSeconds,
          doneKeepSeconds: body.doneKeepSeconds,
          idleEndSeconds: body.idleEndSeconds,
          autoResumeMax: body.autoResumeMax,
        })
        .where(eq(projects.id, projectId));
      return dtoOf(tx, row);
    });
  }

  /**
   * Saves a credential. The address it is for travels inside the Secret, and a credential is used only while the
   * agent's address equals it (`credentialMatchesAddress`). No lock or transaction spans a Secret call.
   *
   * What the kind's capability row allows is checked first, before anything is written: the type must be listed
   * (422 /type), an address only for a kind and type that take one (422 /baseUrl), a type in `baseUrl.requiredFor`
   * needs one (sent or saved), and a pasted `auth_json` must be a JSON object of at most 64 KiB (422 /value). A type
   * that takes no address stores a null one, so the switch from an own endpoint to a file clears it in the same save.
   *
   * An address change goes in this order (BR-16): (1) a short transaction sets the address and clears the credential
   * metadata, (2) the old Secret is deleted, (3) the new Secret is written with the new address, (4) a short
   * transaction sets the metadata again. A failure at (2) or (3) leaves the new address with no credential ("not
   * set"; a Secret left behind is for the old address, so it is never used). Without a change there is one Secret
   * write for the row's current address, then the metadata. Every save resets the stored connection test.
   */
  async putCredential(org: OrgContext, agentId: string, body: PutCredentialRequest): Promise<PutCredentialResponse> {
    const row = await withOrg(this.db, org.orgId, (tx) => agentById(tx, agentId));
    const cap = AGENT_KIND_CAPABILITIES[AgentKind.parse(row.provider)];
    if (!cap.credentialTypes.some((c) => c.type === body.type)) {
      throw new UnprocessableProblemException('This agent does not take this credential type', [
        { pointer: '/type', detail: 'This agent does not take this credential type' },
      ]);
    }
    const required = cap.baseUrl?.requiredFor.includes(body.type) === true;
    const takesAddress = cap.baseUrl !== null && (cap.baseUrl.requiredFor.length === 0 || required);
    if (typeof body.baseUrl === 'string' && !takesAddress) {
      throw new UnprocessableProblemException('This credential type takes no address', [
        { pointer: '/baseUrl', detail: 'This credential type takes no address' },
      ]);
    }
    if (body.type === 'auth_json') checkAuthJson(body.value);
    // undefined keeps the saved address; a type that takes none stores null.
    const nextAddress: string | null | undefined = takesAddress ? body.baseUrl : null;
    if (required && (nextAddress === undefined ? row.baseUrl : nextAddress) === null) {
      throw new UnprocessableProblemException('This credential type needs an address', [
        { pointer: '/baseUrl', detail: 'Enter the address of your API endpoint' },
      ]);
    }
    const name = credentialSecretName(org.orgId, agentId);
    const addressWrite = nextAddress !== undefined && (body.baseUrl !== undefined || row.baseUrl !== null);
    let target: string | null = row.baseUrl;
    if (addressWrite) {
      const baseUrl = nextAddress;
      const changed = await withOrg(this.db, org.orgId, async (tx) => {
        const rows = await tx
          .update(agents)
          .set({
            baseUrl,
            credentialSecretName: null,
            credentialType: null,
            credentialUpdatedAt: null,
            credentialSetBy: null,
            lastTestStatus: null,
            lastTestAt: null,
          })
          .where(eq(agents.id, agentId))
          .returning({ id: agents.id });
        return rows.length > 0;
      });
      if (!changed) throw new NotFoundException('Agent not found');
      await this.storeCredential(agentId, () => this.secrets.delete(name));
      target = baseUrl;
    }
    await this.storeCredential(agentId, () =>
      this.secrets.put(name, credentialSecretData(body.type, body.value, target)),
    );
    const updatedAt = new Date();
    // The address is written only by step (1): this write never moves it.
    await withOrg(this.db, org.orgId, (tx) =>
      tx
        .update(agents)
        .set({
          credentialSecretName: name,
          credentialType: body.type,
          credentialUpdatedAt: updatedAt,
          credentialSetBy: org.userId,
          lastTestStatus: null,
          lastTestAt: null,
        })
        .where(eq(agents.id, agentId)),
    );
    return { updatedAt: updatedAt.toISOString() };
  }

  private async storeCredential(agentId: string, op: () => Promise<void>): Promise<void> {
    try {
      await op();
    } catch (err) {
      // Log the error class only: a store error message could echo request material.
      this.logger.error(
        `credential store write failed for agent ${agentId}: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      // eslint-disable-next-line preserve-caught-error -- deliberate: the cause may echo the credential.
      throw new Error('credential store unavailable');
    }
  }

  async models(org: OrgContext, agentId: string): Promise<AgentModelsDto> {
    const agent = await withOrg(this.db, org.orgId, async (tx) => {
      const row = (await tx.select().from(agents).where(eq(agents.id, agentId)).limit(1))[0];
      if (!row) throw new NotFoundException('Agent not found');
      await assertProjectVisible(tx, row.projectId);
      return row;
    });
    const adapter = agentAdapterFor(AgentKind.parse(agent.provider), { http: this.http });
    const fallback = (reason: NonNullable<AgentModelsDto['reason']>): AgentModelsDto => ({
      source: 'builtin',
      reason,
      models: [...adapter.builtinModels],
    });
    if (this.config.AGENT_MODELS_SOURCE === 'builtin') return fallback('disabled');
    if (agent.credentialType === null || agent.credentialUpdatedAt === null) return fallback('no_credential');
    let stored: Record<string, string> | null;
    try {
      stored = await this.secrets.get(credentialSecretName(org.orgId, agentId));
    } catch (err) {
      this.logger.error(
        `credential store read failed for agent ${agentId}: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      // eslint-disable-next-line preserve-caught-error -- deliberate: the cause may echo secret material.
      throw new Error('credential store unavailable');
    }
    // A missing or unusable Secret, or one saved for another address, is no credential; it is never sent anywhere.
    const credential = parseCredentialSecret(stored);
    if (!credential || !credentialMatchesAddress(credential, agent.baseUrl)) return fallback('no_credential');
    try {
      const list = await adapter.listModels({
        credential: { type: credential.type, value: credential.value },
        baseUrl: agent.baseUrl,
      });
      return list.length === 0 ? fallback('empty') : { source: 'live', reason: null, models: list };
    } catch (err) {
      const kind = err instanceof AgentModelsError ? err.kind : 'unreachable';
      // Class and host only: never the upstream body, the credential or headers.
      this.logger.warn(
        `model list failed for agent ${agentId}: ${err instanceof Error ? err.name : 'unknown'} ${kind} host ${hostOf(agent.baseUrl)}`,
      );
      return fallback(kind === 'rejected' ? 'rejected' : 'unreachable');
    }
  }
}
