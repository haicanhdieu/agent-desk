import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import type { ProblemSchema } from '@agentdesk/contracts';
import { requestContext } from './request-context';
import { type ValidationIssue, ValidationProblemException, toIssues } from './zod-validation';
import type { Logger } from 'pino';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

const CLIENT_ERROR_DETAIL: Record<number, string> = {
  400: 'Malformed request',
  413: 'Request body too large',
  415: 'Unsupported media type',
};

function clientErrorStatus(e: unknown): number | undefined {
  if (typeof e !== 'object' || e === null || !('statusCode' in e)) return undefined;
  const code = e.statusCode;
  return typeof code === 'number' && Number.isInteger(code) && code >= 400 && code <= 499 ? code : undefined;
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const requestId = requestContext.get()?.requestId ?? host.switchToHttp().getRequest<FastifyRequest>().id;
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let detail: string | undefined;
    let errors: ValidationIssue[] | undefined;

    if (exception instanceof ValidationProblemException) {
      status = 400;
      detail = 'Request validation failed';
      errors = exception.issues;
    } else if (exception instanceof ZodValidationException) {
      status = 400;
      detail = 'Request validation failed';
      const zerr = exception.getZodError();
      errors = zerr instanceof z.ZodError ? toIssues(zerr) : [];
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      detail = typeof body === 'string' ? body : exception.message;
    } else if (clientErrorStatus(exception) !== undefined) {
      // Fastify-native 4xx (malformed JSON, 413, 415, ...): fixed text per status, never the raw message.
      status = clientErrorStatus(exception) ?? 400;
      detail = CLIENT_ERROR_DETAIL[status] ?? 'The request could not be processed';
    } else {
      // Unexpected: never leak internals to the client.
      this.logger.error({ err: exception instanceof Error ? exception.message : 'unknown' }, 'unhandled exception');
    }

    const problem: ProblemSchema = {
      type: 'about:blank',
      title: TITLES[status] ?? HttpStatus[status] ?? 'Error',
      status,
      ...(detail !== undefined && status !== 500 ? { detail } : {}),
      ...(requestId ? { requestId } : {}),
      ...(errors ? { errors } : {}),
    };
    void reply.status(status).header('content-type', PROBLEM_CONTENT_TYPE).send(problem);
  }
}
