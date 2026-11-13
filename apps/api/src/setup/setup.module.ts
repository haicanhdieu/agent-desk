import { Module } from '@nestjs/common';
import { SetupScriptController } from './setup-script.controller';
import { SetupScriptService } from './setup-script.service';

@Module({
  controllers: [SetupScriptController],
  providers: [SetupScriptService],
  exports: [SetupScriptService],
})
export class SetupModule {}
