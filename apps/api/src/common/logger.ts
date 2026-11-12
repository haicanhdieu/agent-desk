import type { LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';
import { requestContext } from './request-context';

export function createLogger(level = process.env['LOG_LEVEL'] ?? 'info'): Logger {
  return pino({
    level,
    mixin: () => {
      const ctx = requestContext.get();
      return ctx ? { requestId: ctx.requestId, orgId: ctx.orgId, runId: ctx.runId } : {};
    },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
  });
}

/** Routes Nest's internal logging through pino. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly pino: Logger) {}
  write(level: 'info' | 'error' | 'warn' | 'debug' | 'trace', message: unknown, context?: string): void {
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    this.pino[level]({ context }, text);
  }
  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, typeof rest[1] === 'string' ? rest[1] : undefined);
  }
  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string): void {
    this.write('trace', message, context);
  }
}
