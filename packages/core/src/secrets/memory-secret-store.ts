import { assertSecretName, type SecretStore } from './secret-store';

/** In-memory store for tests. */
export class MemorySecretStore implements SecretStore {
  private readonly items = new Map<string, Record<string, string>>();

  async put(name: string, data: Record<string, string>): Promise<void> {
    assertSecretName(name);
    this.items.set(name, { ...data });
  }
  async get(name: string): Promise<Record<string, string> | null> {
    assertSecretName(name);
    const v = this.items.get(name);
    return v ? { ...v } : null;
  }
  async delete(name: string): Promise<void> {
    assertSecretName(name);
    this.items.delete(name);
  }
  /** Test helper: names currently stored. */
  names(): string[] {
    return [...this.items.keys()];
  }
}
