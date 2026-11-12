import { Global, Module } from '@nestjs/common';
import { createSecretStore, type SecretStore } from '@agentdesk/core';
import { CONFIG, type Config } from '../config/config.module';

export const SECRET_STORE = Symbol('SECRET_STORE');

@Global()
@Module({
  providers: [
    { provide: SECRET_STORE, inject: [CONFIG], useFactory: (config: Config): SecretStore => createSecretStore(config) },
  ],
  exports: [SECRET_STORE],
})
export class SecretStoreModule {}
