import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Clock } from '../../clock';
import { systemClock } from '../../clock';
import { RepoFileError } from '../types';

export const FAKE_REPOS = ['dev/demo'];
export const FAKE_BOT = 'agentdesk[bot]';

const StoredTicket = z.object({
  repoPath: z.string(),
  number: z.number().int(),
  kind: z.enum(['issue', 'pr']),
  title: z.string(),
  labels: z.array(z.object({ name: z.string(), color: z.string() })),
});
export type StoredTicket = z.infer<typeof StoredTicket>;
const TicketsFile = z.object({ tickets: z.array(StoredTicket) });

const StoredComment = z.object({
  id: z.string(),
  repoPath: z.string(),
  ticketRef: z.string(),
  body: z.string(),
  author: z.string(),
  authorAssociation: z.string(),
  createdAt: z.string(),
});
export type StoredComment = z.infer<typeof StoredComment>;
const PostedComment = z.object({
  id: z.string(),
  repoPath: z.string(),
  ticketRef: z.string(),
  body: z.string(),
  at: z.string(),
});
export type PostedComment = z.infer<typeof PostedComment>;
export type NewComment = Omit<StoredComment, 'id' | 'createdAt'>;

const SKILL_NAME = /^[a-z0-9-]+$/;
const SEGMENT = /^[A-Za-z0-9._-]+$/;
function safeSegments(path: string): string[] {
  const parts = path.split('/');
  if (parts.some((p) => !SEGMENT.test(p) || p === '.' || p === '..'))
    throw new Error(`invalid path segment in "${path}"`);
  return parts;
}

export const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex');

/**
 * File-backed state shared by the api and worker processes. Logs are append-only (a single O_APPEND write per line);
 * whole-file documents are written to a unique temp file and renamed into place, so readers never see partial data.
 */
export class FakeStore {
  constructor(
    readonly dir: string,
    private readonly clock: Clock = systemClock,
  ) {}

  private path(...p: string[]): string {
    return join(this.dir, ...p);
  }

  private async atomicWrite(file: string, data: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, file);
  }

  private async readOrNull(file: string): Promise<string | null> {
    try {
      return await readFile(file, 'utf8');
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null;
      throw e;
    }
  }

  private async appendLine(file: string, value: unknown): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8');
  }

  private async readLines<T>(file: string, schema: z.ZodType<T>): Promise<T[]> {
    const raw = await this.readOrNull(file);
    if (!raw) return [];
    const out: T[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        continue; // torn trailing line from a concurrent writer; it is re-read on the next poll
      }
      const parsed = schema.safeParse(json);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  // ---- tickets

  async listTickets(): Promise<StoredTicket[]> {
    const raw = await this.readOrNull(this.path('tickets.json'));
    if (!raw) return [];
    return TicketsFile.parse(JSON.parse(raw)).tickets;
  }

  async addTicket(t: StoredTicket): Promise<void> {
    const all = (await this.listTickets()).filter((x) => !(x.repoPath === t.repoPath && x.number === t.number));
    await this.atomicWrite(this.path('tickets.json'), JSON.stringify({ tickets: [...all, t] }, null, 2));
  }

  async getTicket(repoPath: string, number: number): Promise<StoredTicket | undefined> {
    return (await this.listTickets()).find((t) => t.repoPath === repoPath && t.number === number);
  }

  // ---- comments

  async listComments(): Promise<StoredComment[]> {
    return this.readLines(this.path('comments.jsonl'), StoredComment);
  }

  /** Appends a comment; `createdAt` is strictly increasing so a `since` cursor never skips a same-millisecond comment. */
  async addComment(c: NewComment): Promise<StoredComment> {
    const existing = await this.listComments();
    const last = existing.reduce((m, x) => Math.max(m, Date.parse(x.createdAt)), 0);
    const at = Math.max(this.clock.now().getTime(), last + 1);
    const comment: StoredComment = { ...c, id: randomUUID(), createdAt: new Date(at).toISOString() };
    await this.appendLine(this.path('comments.jsonl'), comment);
    return comment;
  }

  /** Records a comment posted by the desk (posted.jsonl) and makes it visible on the board like any other comment. */
  async postBotComment(repoPath: string, ticketRef: string, body: string): Promise<string> {
    const c = await this.addComment({ repoPath, ticketRef, body, author: FAKE_BOT, authorAssociation: 'OWNER' });
    await this.appendLine(this.path('posted.jsonl'), {
      id: c.id,
      repoPath,
      ticketRef,
      body,
      at: c.createdAt,
    });
    return c.id;
  }

  /** Comments the desk itself posted (posted.jsonl), oldest first. */
  async listPosted(): Promise<PostedComment[]> {
    return this.readLines(this.path('posted.jsonl'), PostedComment);
  }

  // ---- repo files (repo-files/<repo>/<path>), so tests and dev can seed e.g. .claude/settings.json

  private repoFile(repoPath: string, path: string): string {
    return this.path('repo-files', ...safeSegments(repoPath), ...safeSegments(path));
  }

  /** The file's text, or null when it does not exist. A directory is a `RepoFileError`. */
  async readRepoFile(repoPath: string, path: string): Promise<string | null> {
    const file = this.repoFile(repoPath, path);
    try {
      return await this.readOrNull(file);
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'EISDIR') throw new RepoFileError('path is a directory');
      throw e;
    }
  }

  async writeRepoFile(repoPath: string, path: string, body: string): Promise<void> {
    await this.atomicWrite(this.repoFile(repoPath, path), body);
  }

  // ---- skills (skills/<repo>/<name>.md)

  private skillFile(repoPath: string, name: string): string {
    if (!SKILL_NAME.test(name)) throw new Error(`invalid skill name "${name}"`);
    return this.path('skills', ...safeSegments(repoPath), `${name}.md`);
  }

  async readSkillFile(repoPath: string, name: string): Promise<{ body: string; sha: string; mtime: string } | null> {
    const file = this.skillFile(repoPath, name);
    const body = await this.readOrNull(file);
    if (body === null) return null;
    return { body, sha: sha1(body), mtime: (await stat(file)).mtime.toISOString() };
  }

  async writeSkillFile(repoPath: string, name: string, body: string): Promise<string> {
    await this.atomicWrite(this.skillFile(repoPath, name), body);
    return sha1(body);
  }

  async deleteSkillFile(repoPath: string, name: string): Promise<boolean> {
    const file = this.skillFile(repoPath, name);
    if ((await this.readOrNull(file)) === null) return false;
    await rm(file, { force: true });
    return true;
  }

  async listSkillNames(repoPath: string): Promise<string[]> {
    const dir = this.path('skills', ...safeSegments(repoPath));
    try {
      return (await readdir(dir))
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.slice(0, -3))
        .sort();
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return [];
      throw e;
    }
  }
}
