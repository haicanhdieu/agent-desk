import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { Logger } from 'pino';
import { ProblemFilter } from './common/problem.filter';
import { pickRequestId, requestContext } from './common/request-context';
import { PinoNestLogger, createLogger } from './common/logger';
import { AppModule } from './app.module';

export function createAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    // A caller-supplied id is honoured only when it is short and log-safe.
    requestIdHeader: false,
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) =>
      pickRequestId(req.headers['x-request-id'], randomUUID),
  });
}

/** Wiring shared by main.ts and the test app: request context, x-request-id, problem filter, OpenAPI docs. */
export function configureApp(app: NestFastifyApplication, logger: Logger): void {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (req, reply, done) => {
    void reply.header('x-request-id', req.id);
    requestContext.run({ requestId: req.id }, done);
  });
  fastify.addHook('onResponse', (req, reply, done) => {
    logger.info(
      { method: req.method, url: req.url.split('?')[0], status: reply.statusCode, ms: Math.round(reply.elapsedTime) },
      'request',
    );
    done();
  });
  app.useGlobalFilters(new ProblemFilter(logger));
  mountDocs(app);
}

function mountDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Agent Desk API')
    .setVersion('0.0.0')
    .setOpenAPIVersion('3.1.0')
    .build();
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  // Public: no session required for the spec or the UI.
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs/json' });
}

export async function createApp(): Promise<NestFastifyApplication> {
  const logger = createLogger();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createAdapter(), {
    logger: new PinoNestLogger(logger),
  });
  configureApp(app, logger);
  app.enableShutdownHooks();
  return app;
}
