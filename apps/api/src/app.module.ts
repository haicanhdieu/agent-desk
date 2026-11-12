import { Module } from '@nestjs/common';
import { AdapterRegistryModule } from './adapters/adapter-registry.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { ConnectionsController } from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { ProjectSchedules } from './projects/project-schedules';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { TemporalClientModule } from './temporal/temporal-client.module';

@Module({
  imports: [ConfigModule, DbModule, TemporalClientModule, AdapterRegistryModule, AuthModule],
  controllers: [HealthController, ConnectionsController, ProjectsController],
  providers: [ConnectionsService, ProjectSchedules, ProjectsService],
})
export class AppModule {}
