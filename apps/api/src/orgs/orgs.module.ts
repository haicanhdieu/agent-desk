import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChecklistController } from './checklist.controller';
import { ChecklistService } from './checklist.service';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';
import { PlatformOrgsController } from './platform-orgs.controller';

@Module({
  imports: [AuthModule],
  controllers: [PlatformOrgsController, ChecklistController, OrgsController],
  providers: [OrgsService, ChecklistService],
  exports: [OrgsService],
})
export class OrgsModule {}
