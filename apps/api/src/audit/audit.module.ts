import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { PlatformAuditController } from './platform-audit.controller';
import { PlatformAuditService } from './platform-audit.service';

@Module({
  imports: [AuthModule],
  controllers: [AuditController, PlatformAuditController],
  providers: [AuditService, PlatformAuditService],
})
export class AuditModule {}
