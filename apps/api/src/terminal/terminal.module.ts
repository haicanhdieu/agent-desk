import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TerminalGateway } from './terminal.gateway';

@Module({ imports: [AuthModule], providers: [TerminalGateway] })
export class TerminalModule {}
