import { Global, Module } from '@nestjs/common';
import { createKubeGateway, type KubeGateway } from '@agentdesk/core';
import { CONFIG, type Config } from '../config/config.module';

export const KUBE_GATEWAY = Symbol('KUBE_GATEWAY');

/**
 * The control plane's Kubernetes access. Built exactly like the worker's (`createKubeGateway(config)`): in
 * KUBE_MODE=fake both resolve FAKE_STATE_DIR to the same absolute directory, so the api attaches to pods the worker made.
 */
@Global()
@Module({
  providers: [
    { provide: KUBE_GATEWAY, inject: [CONFIG], useFactory: (config: Config): KubeGateway => createKubeGateway(config) },
  ],
  exports: [KUBE_GATEWAY],
})
export class KubeGatewayModule {}
