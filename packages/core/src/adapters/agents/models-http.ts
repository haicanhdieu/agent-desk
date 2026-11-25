import { z } from 'zod';
import { AgentModelId, type AgentModelOption } from '@agentdesk/contracts';
import { GuardedHttpError } from '../../net/guarded-http';
import { AgentModelsError, type AgentHttpGet } from './types';

/** One budget for a list call. */
export const OPENAI_LIST_TIMEOUT_MS = 5000;

const ModelsBody = z.object({ data: z.array(z.object({ id: z.unknown() })) });

/**
 * GET an OpenAI-style `{ data: [{ id }] }` list with a Bearer key. Every failure is an AgentModelsError carrying only a kind:
 * transport failures read as unreachable, an unparsable or oversized body as invalid. Hostile and duplicate ids are dropped.
 */
export async function fetchBearerModelList(http: AgentHttpGet, url: URL, key: string): Promise<AgentModelOption[]> {
  let res: { status: number; json: unknown };
  try {
    res = await http(url, { authorization: `Bearer ${key}` }, { timeoutMs: OPENAI_LIST_TIMEOUT_MS });
  } catch (e) {
    // The cause is dropped on purpose; only the guarded body-shape failures are told apart from a dead transport.
    const bodyProblem = e instanceof GuardedHttpError && (e.kind === 'bad_json' || e.kind === 'too_large');
    throw new AgentModelsError(bodyProblem ? 'invalid' : 'unreachable');
  }
  if (res.status === 401 || res.status === 403) throw new AgentModelsError('rejected');
  if (res.status < 200 || res.status >= 300) throw new AgentModelsError('invalid');
  const parsed = ModelsBody.safeParse(res.json);
  if (!parsed.success) throw new AgentModelsError('invalid');
  const seen = new Set<string>();
  const models: AgentModelOption[] = [];
  for (const m of parsed.data.data) {
    const id = AgentModelId.safeParse(m.id);
    if (!id.success || seen.has(id.data)) continue;
    seen.add(id.data);
    models.push({ id: id.data, label: id.data });
  }
  return models;
}

/** The status word for a failed list; anything unexpected reads as unreachable. */
export function statusOf(e: unknown): 'rejected' | 'unreachable' | 'invalid' {
  return e instanceof AgentModelsError ? e.kind : 'unreachable';
}
