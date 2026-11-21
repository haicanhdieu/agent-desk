import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { connections, inboundEvents, projects, runs, withOrg, type Db } from '@agentdesk/db';
import { Provider, type PrState, type PrStatesResponse } from '@agentdesk/contracts';
import { toAdapterProject, type AdapterRegistry } from '@agentdesk/core';
import { ADAPTER_REGISTRY } from '../adapters/adapter-registry.module';
import type { OrgContext } from '../auth/org-context';
import { LOGGER } from '../common/logger';
import { DB } from '../db/db.module';
import { PR_STATE_LOOKUP, PrStateCache, type PrStateLookupOptions } from './pr-state-cache';

/** Rejects with a plain error after `ms`; the timer is always cleared and the losing promise's rejection is absorbed. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class TicketsService {
  private readonly cache: PrStateCache;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ADAPTER_REGISTRY) private readonly registry: AdapterRegistry,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(PR_STATE_LOOKUP) private readonly opts: PrStateLookupOptions,
  ) {
    this.cache = new PrStateCache(opts.clock, opts);
  }

  /**
   * Live states of the project's PR tickets among `refs`. Only refs the project knows (a PR run, or any ignored
   * inbound event) are looked up, in the project's own repo. A failed or slow lookup leaves those refs out.
   */
  async prStates(org: OrgContext, projectId: string, refs: string[]): Promise<PrStatesResponse> {
    const { row, known } = await withOrg(this.db, org.orgId, async (tx) => {
      const [project] = await tx
        .select({
          repoPath: projects.repoPath,
          defaultBranch: projects.defaultBranch,
          provider: connections.provider,
          externalId: connections.externalId,
        })
        .from(projects)
        .innerJoin(connections, eq(connections.id, projects.boardConnectionId))
        .where(eq(projects.id, projectId))
        .limit(1);
      if (!project) throw new NotFoundException('Project not found');
      const fromRuns = await tx
        .select({ ref: runs.ticketRef })
        .from(runs)
        .where(and(eq(runs.projectId, projectId), eq(runs.ticketKind, 'pr'), inArray(runs.ticketRef, refs)));
      const fromEvents = await tx
        .select({ ref: inboundEvents.ticketRef })
        .from(inboundEvents)
        .where(
          and(
            eq(inboundEvents.projectId, projectId),
            sql`starts_with(${inboundEvents.outcome}, 'ignored_')`,
            inArray(inboundEvents.ticketRef, refs),
          ),
        );
      const set = new Set<string>();
      for (const r of [...fromRuns, ...fromEvents]) if (r.ref !== null) set.add(r.ref);
      return { row: project, known: refs.filter((r) => set.has(r)) };
    });

    const states = new Map<string, PrState>();
    const misses: string[] = [];
    for (const ref of known) {
      const hit = this.cache.get(projectId, ref);
      if (hit) states.set(ref, hit);
      else misses.push(ref);
    }

    if (misses.length > 0) {
      try {
        const board = this.registry.board(Provider.parse(row.provider));
        const found = await withTimeout(
          board.prStates(toAdapterProject(row, row.externalId), misses),
          this.opts.timeoutMs,
        );
        for (const ref of misses) {
          const state = found.get(ref);
          if (state === undefined) continue;
          states.set(ref, state);
          this.cache.set(projectId, ref, state);
        }
      } catch (err) {
        // Name only: provider text and tokens can ride in a message.
        this.logger.warn(
          { projectId, refs: misses.length, err: err instanceof Error ? err.name : 'unknown' },
          'pr states unavailable',
        );
      }
    }

    return {
      items: known.flatMap((ref) => {
        const prState = states.get(ref);
        return prState === undefined ? [] : [{ ref, prState }];
      }),
    };
  }
}
