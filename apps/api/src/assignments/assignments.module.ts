import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrgsModule } from '../orgs/orgs.module';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { MeController } from './me.controller';
import { PlatformAssignmentsController } from './platform-assignments.controller';
import { RolesController } from './roles.controller';

@Module({
  imports: [OrgsModule, AuthModule],
  controllers: [AssignmentsController, MeController, PlatformAssignmentsController, RolesController],
  providers: [AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
