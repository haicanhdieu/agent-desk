import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { ProjectsController } from './projects/projects.controller';
import { TemporalClientModule } from './temporal/temporal-client.module';

@Module({
  imports: [ConfigModule, DbModule, TemporalClientModule, AuthModule],
  controllers: [HealthController, ProjectsController],
})
export class AppModule {}
