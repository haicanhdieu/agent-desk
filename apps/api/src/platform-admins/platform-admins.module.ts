import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformSessionController } from './platform-session.controller';
import { PlatformAdminsController } from './platform-admins.controller';
import { PlatformAdminsService } from './platform-admins.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformAdminsController, PlatformSessionController],
  providers: [PlatformAdminsService],
  exports: [PlatformAdminsService],
})
export class PlatformAdminsModule {}
