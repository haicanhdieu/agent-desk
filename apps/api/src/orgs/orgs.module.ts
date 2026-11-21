import { Module } from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { PlatformOrgsController } from './platform-orgs.controller';

@Module({
  controllers: [PlatformOrgsController],
  providers: [OrgsService],
  exports: [OrgsService],
})
export class OrgsModule {}
