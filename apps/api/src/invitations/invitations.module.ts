import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { InvitationsService } from './invitations.service';
import { PlatformInvitationsController } from './platform-invitations.controller';

@Module({
  imports: [OrgsModule],
  controllers: [PlatformInvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
