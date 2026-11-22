import { Module } from '@nestjs/common';
import { systemClock } from '@agentdesk/core';
import { AdapterRegistryModule } from './adapters/adapter-registry.module';
import { AgentsController } from './agents/agents.controller';
import { agentHttpProvider } from './agents/agent-http.provider';
import { AgentsService } from './agents/agents.service';
import { AuditModule } from './audit/audit.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { ConnectionsController } from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';
import { DbModule } from './db/db.module';
import { IntakeModule } from './intake/intake.module';
import { InvitationsModule } from './invitations/invitations.module';
import { MembersModule } from './members/members.module';
import { KubeGatewayModule } from './kube/kube-gateway.module';
import { OrgsModule } from './orgs/orgs.module';
import { PlatformAdminsModule } from './platform-admins/platform-admins.module';
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
import { SetupModule } from './setup/setup.module';
import { SkillsController } from './skills/skills.controller';
import { SkillsService } from './skills/skills.service';
import { RunStatusListener } from './sse/run-status-listener';
import { SseController } from './sse/sse.controller';
import { SseService } from './sse/sse.service';
import { PR_STATE_LOOKUP, PR_STATE_LOOKUP_DEFAULTS } from './tickets/pr-state-cache';
import { TicketsController } from './tickets/tickets.controller';
import { TicketsService } from './tickets/tickets.service';
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
    SetupModule,
    OrgsModule,
    InvitationsModule,
    AssignmentsModule,
    MembersModule,
    PlatformAdminsModule,
    AuditModule,
  ],
  controllers: [
    HealthController,
    ConnectionsController,
    ProjectsController,
    AgentsController,
    RulesController,
    SkillsController,
    RunsController,
    TicketsController,
    SseController,
  ],
  providers: [
    ConnectionsService,
    ProjectSchedules,
    ProjectsService,
    agentHttpProvider,
    AgentsService,
    RulesService,
    SkillsService,
    RunsService,
    TicketsService,
    { provide: PR_STATE_LOOKUP, useValue: { clock: systemClock, ...PR_STATE_LOOKUP_DEFAULTS } },
    RunStatusListener,
    SseService,
  ],
})
export class AppModule {}
