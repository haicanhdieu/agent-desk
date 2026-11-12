import type { CoreV1Api } from '@kubernetes/client-node';
import { assertSecretName, type SecretStore } from './secret-store';

/** The slice of CoreV1Api used here (object-parameter style of @kubernetes/client-node v2). */
export type SecretsApi = Pick<
  CoreV1Api,
  'createNamespacedSecret' | 'replaceNamespacedSecret' | 'readNamespacedSecret' | 'deleteNamespacedSecret'
>;

export const SECRET_LABELS = {
  'app.kubernetes.io/managed-by': 'agentdesk',
  'agentdesk/kind': 'credential',
} as const;

function statusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  if ('code' in err && typeof err.code === 'number') return err.code;
  if ('statusCode' in err && typeof err.statusCode === 'number') return err.statusCode;
  return undefined;
}

/** Credentials as Kubernetes Secrets in the app namespace (create-or-replace). */
export class KubeSecretStore implements SecretStore {
  constructor(
    private readonly api: SecretsApi,
    private readonly namespace: string,
  ) {}

  async put(name: string, data: Record<string, string>): Promise<void> {
    assertSecretName(name);
    const body = {
      metadata: { name, namespace: this.namespace, labels: { ...SECRET_LABELS } },
      type: 'Opaque',
      stringData: data,
    };
    try {
      await this.api.createNamespacedSecret({ namespace: this.namespace, body });
    } catch (err) {
      if (statusOf(err) !== 409) throw err;
      await this.api.replaceNamespacedSecret({ name, namespace: this.namespace, body });
    }
  }

  async get(name: string): Promise<Record<string, string> | null> {
    assertSecretName(name);
    try {
      const secret = await this.api.readNamespacedSecret({ name, namespace: this.namespace });
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(secret.data ?? {})) out[k] = Buffer.from(v, 'base64').toString('utf8');
      return out;
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
  }

  async delete(name: string): Promise<void> {
    assertSecretName(name);
    try {
      await this.api.deleteNamespacedSecret({ name, namespace: this.namespace });
    } catch (err) {
      if (statusOf(err) !== 404) throw err;
    }
  }
}
