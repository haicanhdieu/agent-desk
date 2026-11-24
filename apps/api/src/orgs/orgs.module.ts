import { Module } from '@nestjs/common';
import { systemClock } from '@agentdesk/core';
import { AuthModule } from '../auth/auth.module';
import { CLOCK } from '../common/clock';
import { ChecklistController } from './checklist.controller';
import { ChecklistService } from './checklist.service';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';
import { PlatformOrgsController } from './platform-orgs.controller';

@Module({
  imports: [AuthModule],
  controllers: [PlatformOrgsController, ChecklistController, OrgsController],
  providers: [OrgsService, ChecklistService, { provide: CLOCK, useValue: systemClock }],
  exports: [OrgsService],
})
export class OrgsModule {}
