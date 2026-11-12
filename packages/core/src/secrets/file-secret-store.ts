import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { assertSecretName, type SecretStore } from './secret-store';

const FileData = z.record(z.string(), z.string());

/** Local-dev store (KUBE_MODE=fake): one JSON file per secret, mode 0600 in a 0700 directory, written atomically. */
export class FileSecretStore implements SecretStore {
  constructor(private readonly dir: string) {}

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
  }

  private path(name: string): string {
    assertSecretName(name);
    return join(this.dir, `${name}.json`);
  }

  async put(name: string, data: Record<string, string>): Promise<void> {
    const target = this.path(name);
    await this.ensureDir();
    const tmp = join(this.dir, `.${name}.${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async get(name: string): Promise<Record<string, string> | null> {
    const target = this.path(name);
    let raw: string;
    try {
      raw = await readFile(target, 'utf8');
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') return null;
      throw err;
    }
    return FileData.parse(JSON.parse(raw));
  }

  async delete(name: string): Promise<void> {
    await rm(this.path(name), { force: true });
  }
}
