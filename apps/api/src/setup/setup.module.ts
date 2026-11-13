import { Module } from '@nestjs/common';
import { SetupScriptController } from './setup-script.controller';
import { SetupScriptService } from './setup-script.service';
import { SetupTestStream } from './setup-test-stream';
import { SetupTestsController } from './setup-tests.controller';
import { SetupTestsService } from './setup-tests.service';

@Module({
  controllers: [SetupScriptController, SetupTestsController],
  providers: [SetupScriptService, SetupTestsService, SetupTestStream],
  exports: [SetupScriptService, SetupTestsService],
})
export class SetupModule {}
