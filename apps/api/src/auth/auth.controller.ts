import { All, Controller, Inject, NotFoundException, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CONFIG, type Config } from '../config/config.module';
import { AUTH, type Auth } from './auth';

/** Email/password endpoints exist only for the server-side dev-login; they are never reachable over HTTP. */
const BLOCKED_PREFIXES = ['/auth/sign-in/email', '/auth/sign-up/email'];
const SKIPPED_RESPONSE_HEADERS = new Set(['set-cookie', 'content-length', 'content-encoding', 'transfer-encoding']);

/** Forwards `/auth/*` to the better-auth handler (Fetch API Request/Response). */
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @All('*')
  async handle(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    // Check the normalized pathname (dot segments resolved), the same one better-auth routes on.
    const url = new URL(req.url, this.config.PUBLIC_ORIGIN);
    const path = url.pathname.toLowerCase().replace(/\/+$/, '');
    if (BLOCKED_PREFIXES.some((p) => path.startsWith(p))) throw new NotFoundException('Not found');

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'content-length') continue;
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined) headers.set(k, v);
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && req.body !== null;
    const request = new Request(url, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body) : undefined,
    });
    const response = await this.auth.handler(request);

    for (const [k, v] of response.headers) {
      if (!SKIPPED_RESPONSE_HEADERS.has(k)) void reply.header(k, v);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) void reply.header('set-cookie', cookies);
    void reply.status(response.status).send(await response.text());
  }
}
