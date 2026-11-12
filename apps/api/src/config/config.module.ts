import { Global, Module } from '@nestjs/common';
import { parseConfig, type Config } from './config.schema';

export const CONFIG = Symbol('CONFIG');
export type { Config };

/** Config is parsed once from process.env at startup; an invalid environment fails boot. */
@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): Config => parseConfig(process.env) }],
  exports: [CONFIG],
})
export class ConfigModule {}
