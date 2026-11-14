import 'reflect-metadata';
import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodPipe } from '../src/common/zod-validation';
import { parseConfig } from '../src/config/config.schema';
import { createTestApp, validEnv, type TestApp } from './helpers/app';

const NameBody = z.object({ name: z.string().min(1) });

@Controller('test-only')
class TestOnlyController {
  @Post('validate')
  validate(@Body(new ZodPipe(NameBody)) body: z.infer<typeof NameBody>) {
    return body;
  }
}

@Controller('test-only')
class BoomController {
  @Get('missing')
  missing(): never {
    throw new NotFoundException('Widget 7 not found');
  }

  @Get('boom')
  boom(): never {
    throw new Error('secret internal detail');
  }
}

describe('config', () => {
  it('rejects a BETTER_AUTH_SECRET shorter than 32 characters', () => {
    expect(() => parseConfig({ ...validEnv(), BETTER_AUTH_SECRET: 'short' })).toThrow(/BETTER_AUTH_SECRET/);
  });
  it('fails on missing value', () => {
    expect(() => parseConfig({})).toThrow(/DATABASE_APP_URL/);
  });
  it('treats empty strings as undefined for optional keys', () => {
    const cfg = parseConfig({ ...validEnv(), GITHUB_APP_ID: '', KUBECONFIG: '', OTEL_EXPORTER_OTLP_ENDPOINT: '' });
    expect(cfg.GITHUB_APP_ID).toBeUndefined();
    expect(cfg.KUBECONFIG).toBeUndefined();
    expect(cfg.PORT).toBe(3000);
  });
  it('requires all or none of the GitHub keys', () => {
    expect(() => parseConfig({ ...validEnv(), GITHUB_APP_ID: '1' })).toThrow(/GITHUB_/);
  });
  it('dev flags rejected in production', () => {
    expect(() => parseConfig({ ...validEnv(), NODE_ENV: 'production', AUTH_DEV_LOGIN: 'true' })).toThrow(
      /AUTH_DEV_LOGIN/,
    );
    expect(() => parseConfig({ ...validEnv(), NODE_ENV: 'production', ENABLE_FAKE_PROVIDER: 'true' })).toThrow(
      /ENABLE_FAKE_PROVIDER/,
    );
  });
});

describe('api skeleton', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ controllers: [TestOnlyController, BoomController] });
  });
  afterAll(async () => {
    await t.close();
  });

  it('GET /healthz returns 200 with a generated x-request-id', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
  it('echoes an incoming x-request-id', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': 'abc-123' } });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
  it('GET /readyz is 200 when dependencies are up and 503 problem+json when Temporal is unavailable', async () => {
    const ok = await t.app.inject({ method: 'GET', url: '/readyz' });
    expect(ok.statusCode).toBe(200);
    t.temporal.available = false;
    try {
      const bad = await t.app.inject({ method: 'GET', url: '/readyz' });
      expect(bad.statusCode).toBe(503);
      expect(bad.headers['content-type']).toMatch(/application\/problem\+json/);
    } finally {
      t.temporal.available = true;
    }
  });
  it('unknown route is a 404 problem+json with requestId', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/nope', headers: { 'x-request-id': 'req-404' } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.json()).toMatchObject({ status: 404, requestId: 'req-404' });
  });
  it('validation failure is a 400 with errors[] pointers', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/test-only/validate', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    const body = res.json<{ errors: { pointer: string; detail: string }[] }>();
    expect(body.errors).toEqual([{ pointer: '/name', detail: expect.any(String) }]);
    const ok = await t.app.inject({ method: 'POST', url: '/test-only/validate', payload: { name: 'x' } });
    expect(ok.statusCode).toBe(201);
  });
  it('malformed JSON body is a 400 problem+json', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/test-only/validate',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-json' },
      payload: '{"name": ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.json()).toMatchObject({ status: 400, requestId: 'req-json', detail: 'Malformed request' });
  });
  it('unsupported content-type is a 415 problem+json with fixed detail', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/test-only/validate',
      headers: { 'content-type': 'application/x-weird' },
      payload: 'x',
    });
    expect(res.statusCode).toBe(415);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.json()).toMatchObject({ status: 415, detail: 'Unsupported media type' });
  });
  it('domain-thrown HttpExceptions keep their deliberate message', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/test-only/missing' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ status: 404, detail: 'Widget 7 not found' });
  });
  it('unexpected errors are a 500 problem+json that leaks nothing', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/test-only/boom', headers: { 'x-request-id': 'req-500' } });
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({ status: 500, requestId: 'req-500' });
    expect(body).not.toHaveProperty('detail');
    expect(body).not.toHaveProperty('stack');
    expect(res.body).not.toMatch(/secret internal detail/);
  });
  it('GET /api/docs/json is a public OpenAPI 3.1 document', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ openapi: string }>().openapi).toMatch(/^3\.1/);
    const ui = await t.app.inject({ method: 'GET', url: '/api/docs' });
    expect(ui.statusCode).toBeLessThan(400);
  });
});
