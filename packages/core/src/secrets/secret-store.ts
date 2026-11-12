import { KubeConfig, CoreV1Api } from '@kubernetes/client-node';
import type { Config } from '../config';
import { FileSecretStore } from './file-secret-store';
import { KubeSecretStore } from './kube-secret-store';

/** Write-mostly store for credential material. Values never go to Postgres, logs or API responses. */
export interface SecretStore {
  put(name: string, data: Record<string, string>): Promise<void>;
  get(name: string): Promise<Record<string, string> | null>;
  delete(name: string): Promise<void>;
}

/** Name of the credential secret for an agent (also the Kubernetes Secret name). */
export function credentialSecretName(orgId: string, agentId: string): string {
  return `org-${orgId}-agent-${agentId}`;
}

const SECRET_NAME = /^[a-z0-9-]+$/;
const MAX_NAME = 253;

/** Names become file names and Kubernetes object names: restrict to a safe alphabet (no path traversal). */
export function assertSecretName(name: string): void {
  if (name.length === 0 || name.length > MAX_NAME || !SECRET_NAME.test(name)) {
    throw new Error('invalid secret name');
  }
}

export function createSecretStore(config: Config): SecretStore {
  if (config.KUBE_MODE === 'fake') return new FileSecretStore(`${config.FAKE_STATE_DIR}/secrets`);
  const kc = new KubeConfig();
  if (config.KUBE_MODE === 'incluster') kc.loadFromCluster();
  else if (config.KUBECONFIG) kc.loadFromFile(config.KUBECONFIG);
  else kc.loadFromDefault();
  return new KubeSecretStore(kc.makeApiClient(CoreV1Api), config.APP_NAMESPACE);
}
