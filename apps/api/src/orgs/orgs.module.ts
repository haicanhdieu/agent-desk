import { Module } from '@nestjs/common';
import { ChecklistController } from './checklist.controller';
import { OrgsService } from './orgs.service';
import { PlatformOrgsController } from './platform-orgs.controller';

@Module({
  controllers: [PlatformOrgsController, ChecklistController],
  providers: [OrgsService],
  exports: [OrgsService],
})
export class OrgsModule {}
