import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { PlatformMembersController } from './platform-members.controller';

@Module({
  imports: [OrgsModule],
  controllers: [MembersController, PlatformMembersController],
  providers: [MembersService],
})
export class MembersModule {}
