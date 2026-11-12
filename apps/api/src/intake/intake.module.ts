import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FakeController } from '../dev/fake.controller';
import { IntakeService } from './intake.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [AuthModule],
  controllers: [WebhooksController, FakeController],
  providers: [IntakeService],
  exports: [IntakeService],
})
export class IntakeModule {}
