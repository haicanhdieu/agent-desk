import { Module } from '@nestjs/common';
import { ChecklistController } from './checklist.controller';
import { ChecklistService } from './checklist.service';
import { OrgsService } from './orgs.service';
import { PlatformOrgsController } from './platform-orgs.controller';

@Module({
  controllers: [PlatformOrgsController, ChecklistController],
  providers: [OrgsService, ChecklistService],
  exports: [OrgsService],
})
export class OrgsModule {}
