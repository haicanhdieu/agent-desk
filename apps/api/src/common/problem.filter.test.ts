import type { ArgumentsHost } from '@nestjs/common';
import type { Logger } from 'pino';
import { describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE, PROVIDER_UNAVAILABLE_PROBLEM_TYPE } from '@agentdesk/contracts';
import { ProviderReauthRequiredError, ProviderUnavailableError } from '@agentdesk/core';
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

describe('ProblemFilter provider errors', () => {
  it('answers a rejected or unrefreshable provider token with a 409 of type provider-reauthorization-required', () => {
    const { logger, logged } = capturingLogger();
    const { host: h, sent } = host();
    new ProblemFilter(logger).catch(new ProviderReauthRequiredError(), h);
    expect(sent.status).toBe(409);
    expect(sent.body).toEqual({
      type: PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE,
      title: 'Conflict',
      status: 409,
      detail: 'Your account at the provider must be connected again.',
      requestId: 'req-1',
    });
    expect(JSON.stringify(logged)).toContain('ProviderReauthRequiredError');
  });

  it('answers a provider outage with a 503 and a rate limit with a 429, both of type provider-unavailable, and logs the upstream status', () => {
    const { logger, logged } = capturingLogger();
    const down = host();
    new ProblemFilter(logger).catch(
      new ProviderUnavailableError({ rateLimited: false, upstreamStatus: 502 }),
      down.host,
    );
    expect(down.sent.status).toBe(503);
    expect(down.sent.body).toMatchObject({ type: PROVIDER_UNAVAILABLE_PROBLEM_TYPE, status: 503 });
    const limited = host();
    new ProblemFilter(logger).catch(
      new ProviderUnavailableError({ rateLimited: true, upstreamStatus: 403 }),
      limited.host,
    );
    expect(limited.sent.status).toBe(429);
    expect(limited.sent.body).toMatchObject({ type: PROVIDER_UNAVAILABLE_PROBLEM_TYPE, status: 429 });
    const dump = JSON.stringify(logged);
    expect(dump).toContain('502');
    expect(dump).toContain('ProviderUnavailableError');
  });
});
