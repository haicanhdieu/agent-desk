import { Module } from '@nestjs/common';
import { SkillsService } from '../skills/skills.service';
import { PluginsController } from './plugins.controller';
import { PluginsService } from './plugins.service';
import { SetupScriptController } from './setup-script.controller';
import { SetupScriptService } from './setup-script.service';
import { SetupTestStream } from './setup-test-stream';
import { SetupTestsController } from './setup-tests.controller';
import { SetupTestsService } from './setup-tests.service';

@Module({
  controllers: [SetupScriptController, SetupTestsController, PluginsController],
  // SkillsService is stateless; it is listed here for its project -> code host lookup.
  providers: [SetupScriptService, SetupTestsService, SetupTestStream, PluginsService, SkillsService],
  exports: [SetupScriptService, SetupTestsService],
})
export class SetupModule {}
