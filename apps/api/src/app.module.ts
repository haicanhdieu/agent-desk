import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { TemporalClientModule } from './temporal/temporal-client.module';

@Module({
  imports: [ConfigModule, DbModule, TemporalClientModule],
  controllers: [HealthController],
})
export class AppModule {}
