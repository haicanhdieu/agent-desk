import type { ArgumentsHost } from '@nestjs/common';
import type { Logger } from 'pino';
import { describe, expect, it } from 'vitest';
import { ProblemFilter } from './problem.filter';

/** A host whose reply records what was sent. */
function host(): { host: ArgumentsHost; sent: { status?: number; body?: unknown } } {
  const sent: { status?: number; body?: unknown } = {};
  const reply = {
    status(code: number) {
      sent.status = code;
      return reply;
    },
    header() {
      return reply;
    },
    send(body: unknown) {
      sent.body = body;
      return reply;
    },
  };
  const http = { getResponse: () => reply, getRequest: () => ({ id: 'req-1' }) };
  // Only the http accessors are used by the filter.
  const h = { switchToHttp: () => http } as unknown as ArgumentsHost;
  return { host: h, sent };
}

function capturingLogger(): { logger: Logger; logged: unknown[] } {
  const logged: unknown[] = [];
  const record = (...args: unknown[]): void => {
    logged.push(args);
  };
  // The filter only calls `error`; the other levels record too so nothing is silently dropped.
  const logger = { error: record, warn: record, info: record, debug: record } as unknown as Logger;
  return { logger, logged };
}

describe('ProblemFilter', () => {
  it('logs only the error name and pg code of an unexpected error, never its message (query params)', () => {
    const { logger, logged } = capturingLogger();
    const { host: h, sent } = host();
    const cause = Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: '22021' });
    const err = new Error('Failed query: insert into "setup_script_versions" params: proj,SECRET_SCRIPT_TEXT,alice', {
      cause,
    });
    new ProblemFilter(logger).catch(err, h);
    expect(sent.status).toBe(500);
    const dump = JSON.stringify(logged);
    expect(dump).not.toContain('SECRET_SCRIPT_TEXT');
    expect(dump).not.toContain('Failed query');
    expect(dump).toContain('22021');
    expect(dump).toContain('Error');
    expect(JSON.stringify(sent.body)).not.toContain('SECRET_SCRIPT_TEXT');
  });

  it('logs "unknown" for a non-Error throw', () => {
    const { logger, logged } = capturingLogger();
    new ProblemFilter(logger).catch('SECRET_SCRIPT_TEXT', host().host);
    expect(JSON.stringify(logged)).not.toContain('SECRET_SCRIPT_TEXT');
  });
});
