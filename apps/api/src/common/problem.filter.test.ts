import type { ArgumentsHost } from '@nestjs/common';
import type { Logger } from 'pino';
import { describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { OrgMismatchException } from './org-mismatch';
import { OrgSuspendedException } from './org-suspended';
import { NotFoundProblemException } from './zod-validation';
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

  it('answers a NotFoundProblemException with 404 and its errors[]', () => {
    const { host: h, sent } = host();
    const issues = [{ pointer: '/email', detail: 'no account has this email' }];
    new ProblemFilter(capturingLogger().logger).catch(new NotFoundProblemException('User not found', issues), h);
    expect(sent.status).toBe(404);
    expect(sent.body).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'User not found',
      requestId: 'req-1',
      errors: issues,
    });
  });

  it('answers an OrgMismatchException with the org-mismatch problem type', () => {
    const { host: h, sent } = host();
    new ProblemFilter(capturingLogger().logger).catch(new OrgMismatchException(), h);
    expect(sent.status).toBe(409);
    expect(sent.body).toEqual({
      type: 'org-mismatch',
      title: 'Conflict',
      status: 409,
      detail: 'The organization in the request is not the active organization',
      requestId: 'req-1',
    });
  });

  it('keeps about:blank for a plain ConflictException', () => {
    const { host: h, sent } = host();
    new ProblemFilter(capturingLogger().logger).catch(new ConflictException('taken'), h);
    expect(sent.body).toMatchObject({ type: 'about:blank', status: 409, detail: 'taken' });
  });
});

describe('ProblemFilter org-suspended', () => {
  it('answers 403 with type org-suspended and only the fixed text', () => {
    const { host: h, sent } = host();
    new ProblemFilter(capturingLogger().logger).catch(new OrgSuspendedException(), h);
    expect(sent.status).toBe(403);
    expect(sent.body).toEqual({
      type: 'org-suspended',
      title: 'Forbidden',
      status: 403,
      detail: 'This organization is suspended.',
      requestId: 'req-1',
    });
  });
});
