import { resolve } from 'node:path';
import type { Config } from '../config';
import { FakeKubeGateway } from './fake-gateway';
import type { KubeGateway } from './gateway';
import { createRealKubeGateway } from './real-gateway';

export * from './gateway';
export * from './job-spec';
export * from './log-parser';
export * from './setup-log';
export { FakeKubeGateway, type FakeKubeOptions } from './fake-gateway';
export {
  RealKubeGateway,
  createRealKubeGateway,
  type ExecConnector,
  type ExecSocket,
  type KubeBatchApi,
  type KubeCoreApi,
  type KubeLogApi,
  type RealKubeDeps,
} from './real-gateway';

/** `KUBE_MODE=fake` → file-backed fake under `FAKE_STATE_DIR/kube`; otherwise the real cluster (`RUNS_NAMESPACE`). */
export function createKubeGateway(
  config: Pick<Config, 'KUBE_MODE' | 'KUBECONFIG' | 'RUNS_NAMESPACE' | 'FAKE_STATE_DIR'>,
): KubeGateway {
  if (config.KUBE_MODE === 'fake') return new FakeKubeGateway(resolve(config.FAKE_STATE_DIR, 'kube'));
  return createRealKubeGateway(config.KUBE_MODE, config.RUNS_NAMESPACE, config.KUBECONFIG);
}
