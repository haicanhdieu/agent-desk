import { Module } from '@nestjs/common';
import { AdapterRegistryModule } from './adapters/adapter-registry.module';
import { AgentsController } from './agents/agents.controller';
import { AgentsService } from './agents/agents.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { ConnectionsController } from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';
import { DbModule } from './db/db.module';
import { IntakeModule } from './intake/intake.module';
import { KubeGatewayModule } from './kube/kube-gateway.module';
import { TerminalModule } from './terminal/terminal.module';
import { HealthController } from './health/health.controller';
import { ProjectSchedules } from './projects/project-schedules';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { RunsController } from './runs/runs.controller';
import { RunsService } from './runs/runs.service';
import { RulesController } from './rules/rules.controller';
import { RulesService } from './rules/rules.service';
import { SecretStoreModule } from './secrets/secret-store.module';
import { SkillsController } from './skills/skills.controller';
import { SkillsService } from './skills/skills.service';
import { RunStatusListener } from './sse/run-status-listener';
import { SseController } from './sse/sse.controller';
import { SseService } from './sse/sse.service';
import { TemporalClientModule } from './temporal/temporal-client.module';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    TemporalClientModule,
    AdapterRegistryModule,
    SecretStoreModule,
    AuthModule,
    IntakeModule,
    KubeGatewayModule,
    TerminalModule,
  ],
  controllers: [
    HealthController,
    ConnectionsController,
    ProjectsController,
    AgentsController,
    RulesController,
    SkillsController,
    RunsController,
    SseController,
  ],
  providers: [
    ConnectionsService,
    ProjectSchedules,
    ProjectsService,
    AgentsService,
    RulesService,
    SkillsService,
    RunsService,
    RunStatusListener,
    SseService,
  ],
})
export class AppModule {}
