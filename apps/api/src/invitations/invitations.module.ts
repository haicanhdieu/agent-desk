import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrgsModule } from '../orgs/orgs.module';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MyInvitationsController } from './my-invitations.controller';
import { MyInvitationsService } from './my-invitations.service';
import { PlatformInvitationsController } from './platform-invitations.controller';

@Module({
  imports: [OrgsModule, AuthModule],
  controllers: [InvitationsController, PlatformInvitationsController, MyInvitationsController],
  providers: [InvitationsService, MyInvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
