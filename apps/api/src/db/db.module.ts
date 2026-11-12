import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Db } from '@agentdesk/db';
import { CONFIG, type Config } from '../config/config.module';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [{ provide: DB, inject: [CONFIG], useFactory: (config: Config): Db => createDb(config.DATABASE_APP_URL) }],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}
  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}
