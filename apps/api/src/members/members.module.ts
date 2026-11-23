import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrgsModule } from '../orgs/orgs.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { PlatformMembersController } from './platform-members.controller';

@Module({
  imports: [AuthModule, OrgsModule],
  controllers: [MembersController, PlatformMembersController],
  providers: [MembersService],
})
export class MembersModule {}
