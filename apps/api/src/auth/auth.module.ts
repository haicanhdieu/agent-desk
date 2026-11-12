import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { Db } from '@agentdesk/db';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';
import { AUTH, createAuth } from './auth';
import { AuthController } from './auth.controller';
import { DevLoginController } from './dev-login.controller';
import { OrgDb } from './org-context';
import { SessionGuard } from './session.guard';

@Module({
  controllers: [DevLoginController, AuthController],
  providers: [
    { provide: AUTH, inject: [CONFIG, DB], useFactory: (config: Config, db: Db) => createAuth(config, db) },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    OrgDb,
  ],
  exports: [AUTH, OrgDb],
})
export class AuthModule {}
