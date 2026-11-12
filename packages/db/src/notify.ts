import { sql } from "drizzle-orm";
import pg from "pg";
import type { Tx } from "./withOrg";

export const RUN_STATUS_CHANNEL = "run_status";

export interface RunStatusMessage {
  orgId: string;
  runId: string;
  seq: number;
}

/** Queues a NOTIFY that Postgres delivers only when the surrounding transaction commits. */
export async function notifyRunStatus(
  tx: Tx,
  msg: RunStatusMessage,
): Promise<void> {
  await tx.execute(
    sql`select pg_notify(${RUN_STATUS_CHANNEL}, ${JSON.stringify(msg)})`,
  );
}

function parseMessage(payload: string | undefined): RunStatusMessage | null {
  if (payload === undefined) return null;
  let v: unknown;
  try {
    v = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const { orgId, runId, seq } = v as Record<string, unknown>;
  if (
    typeof orgId !== "string" ||
    typeof runId !== "string" ||
    typeof seq !== "number"
  )
    return null;
  return { orgId, runId, seq };
}

/** LISTENs on a dedicated connection and reconnects (re-issuing LISTEN) after errors. Returns a stop function. */
export async function listenRunStatus(
  url: string,
  onMsg: (msg: RunStatusMessage) => void,
  opts: { reconnectDelayMs?: number } = {},
): Promise<() => Promise<void>> {
  const delay = opts.reconnectDelayMs ?? 1000;
  let stopped = false;
  let client: pg.Client | null = null;
  let timer: NodeJS.Timeout | null = null;

  const scheduleReconnect = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void connect().catch(scheduleReconnect);
    }, delay);
  };

  const connect = async (): Promise<void> => {
    const c = new pg.Client({ connectionString: url });
    c.on("notification", (n) => {
      if (n.channel !== RUN_STATUS_CHANNEL) return;
      const m = parseMessage(n.payload);
      if (m) onMsg(m);
    });
    let dead = false;
    const onDead = () => {
      if (dead) return;
      dead = true;
      c.removeAllListeners();
      c.on("error", () => undefined);
      c.end().catch(() => undefined);
      if (client === c) client = null;
      scheduleReconnect();
    };
    c.on("error", onDead);
    c.on("end", onDead);
    try {
      await c.connect();
      await c.query(`LISTEN ${RUN_STATUS_CHANNEL}`);
    } catch (e) {
      onDead();
      throw e;
    }
    if (stopped) {
      c.removeAllListeners();
      await c.end();
      return;
    }
    client = c;
  };

  await connect();

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    const c = client;
    client = null;
    if (c) {
      c.removeAllListeners();
      c.on("error", () => undefined);
      await c.end();
    }
  };
}
